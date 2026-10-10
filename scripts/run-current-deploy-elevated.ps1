$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$logPath = Join-Path $sourceRoot 'artifacts\deploy-current-admin.log'
$reportPath = Join-Path $sourceRoot 'artifacts\deploy-current-verify.json'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  $argumentLine = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
  $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList $argumentLine
  exit $elevated.ExitCode
}

try {
  & (Join-Path $PSScriptRoot 'deploy-and-verify-admin.ps1') `
    -SourceRoot $sourceRoot `
    -ReportCopyPath $reportPath *>&1 | Tee-Object -FilePath $logPath
  'DEPLOYMENT_OK' | Add-Content -LiteralPath $logPath -Encoding utf8
  exit 0
} catch {
  $_ | Format-List * -Force | Out-File -LiteralPath $logPath -Append -Encoding utf8
  exit 1
}
