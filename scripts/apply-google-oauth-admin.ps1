$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$configureScript = Join-Path $projectRoot 'scripts\configure-lan.ps1'
$logPath = Join-Path $projectRoot 'dist\installer\google-oauth-service-config.log'

try {
  & $configureScript `
    -InstallRoot 'C:\Program Files\Abdo ERP Local' `
    -DataRoot 'C:\ProgramData\AbdoErpLocal' *>&1 |
    Tee-Object -FilePath $logPath
  exit 0
} catch {
  $_ | Out-String | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 1
}
