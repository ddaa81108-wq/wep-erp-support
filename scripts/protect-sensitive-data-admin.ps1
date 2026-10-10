param(
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
  [string]$DataRoot = 'C:\ProgramData\AbdoErpLocal'
)

$ErrorActionPreference = 'Stop'
$hardeningScript = Join-Path $PSScriptRoot 'harden-windows-services-admin.ps1'
if (-not (Test-Path -LiteralPath $hardeningScript)) { throw 'Service hardening script is missing.' }

& $hardeningScript -InstallRoot $InstallRoot -DataRoot $DataRoot
if ($LASTEXITCODE -ne 0) { throw 'Sensitive-data protection failed.' }
