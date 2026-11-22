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

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
# Reject missing, stale or dirty evidence before stopping any installed service.
& node.exe (Join-Path $SourceRoot 'scripts\assert-release.mjs') $SourceRoot
if ($LASTEXITCODE -ne 0) { throw 'Release verification is required before deployment. Run npm run verify:release.' }
$verifiedRelease = Get-Content -LiteralPath (Join-Path $SourceRoot 'var\release-verification\latest.json') -Raw | ConvertFrom-Json

& (Join-Path $PSScriptRoot 'deploy-built-admin.ps1') -SourceRoot $SourceRoot
& (Join-Path $PSScriptRoot 'verify-installed-app.ps1') -ReportCopyPath $ReportCopyPath
$health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 10
if ($health.data.status -ne 'ready' -or $health.data.build.commit -ne $verifiedRelease.source.commit -or $health.data.build.dirty) {
  throw 'Installed service does not match the verified clean release.'
}
