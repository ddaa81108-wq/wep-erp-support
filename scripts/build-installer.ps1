$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$script = Join-Path $projectRoot 'deployment\windows\installer.iss'
Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Application build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}
$compilerCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
)
$compiler = $compilerCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $compiler) { throw 'Inno Setup 6 compiler was not found.' }

& $compiler /Qp $script
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed with exit code $LASTEXITCODE" }

$installer = Join-Path $projectRoot 'dist\installer\Abdo-ERP-Local-Setup-0.14.0.exe'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Installer output was not created.' }
$serverInstallerScript = Join-Path $projectRoot 'scripts\Install-AbdoERP-WindowsServer2025.ps1'
Copy-Item -LiteralPath $serverInstallerScript -Destination (Join-Path $projectRoot 'dist\installer\Install-AbdoERP-WindowsServer2025.ps1') -Force
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
[PSCustomObject]@{
  Installer = $installer
  SizeMiB = [Math]::Round((Get-Item -LiteralPath $installer).Length / 1MB, 2)
  SHA256 = $hash
} | Format-List
