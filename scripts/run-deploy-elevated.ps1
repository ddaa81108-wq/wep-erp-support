param([string]$SourceRoot = (Split-Path -Parent $PSScriptRoot))

$log = Join-Path $SourceRoot 'artifacts\deploy-admin.log'
try {
  & (Join-Path $PSScriptRoot 'deploy-and-verify-admin.ps1') -SourceRoot $SourceRoot *>&1 |
    Tee-Object -FilePath $log
  exit 0
} catch {
  $_ | Format-List * -Force | Out-File -LiteralPath $log -Append -Encoding utf8
  exit 1
}
