param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$ReportCopyPath = ''
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

& (Join-Path $PSScriptRoot 'deploy-built-admin.ps1') -SourceRoot $SourceRoot
& (Join-Path $PSScriptRoot 'verify-installed-app.ps1') -ReportCopyPath $ReportCopyPath
