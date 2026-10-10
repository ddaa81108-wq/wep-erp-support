param(
  [string]$SourceInstaller,
  [string]$PackageUrl,
  [Parameter(Mandatory = $true)][ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ExpectedSha256,
  [switch]$AllowUpgrade
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from Windows PowerShell as Administrator.'
}
if ([bool]$SourceInstaller -eq [bool]$PackageUrl) {
  throw 'Provide exactly one of -SourceInstaller or -PackageUrl.'
}
$os = Get-CimInstance Win32_OperatingSystem
if ($os.ProductType -eq 1 -or [int]$os.BuildNumber -lt 26100 -or -not [Environment]::Is64BitOperatingSystem) {
  throw "This package targets x64 Windows Server 2025 or newer. Detected: $($os.Caption), build $($os.BuildNumber)."
}
if ((Get-Service -Name AbdoErpLocal -ErrorAction SilentlyContinue) -and -not $AllowUpgrade) {
  throw 'The ERP is already installed. Review the existing database and use -AllowUpgrade only for an intended upgrade.'
}

$downloadRoot = Join-Path $env:ProgramData 'AbdoErpInstall'
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
if ($PackageUrl) {
  $uri = [Uri]$PackageUrl
  if ($uri.Scheme -ne 'https') { throw 'The package URL must use HTTPS.' }
  $installer = Join-Path $downloadRoot 'Abdo-ERP-Local-Setup-0.14.0.exe'
  Invoke-WebRequest -Uri $uri -OutFile $installer -MaximumRedirection 3 -UseBasicParsing
} else {
  $installer = [IO.Path]::GetFullPath($SourceInstaller)
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "Installer not found: $installer" }
}
$actualSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
if ($actualSha256 -ne $ExpectedSha256.ToUpperInvariant()) {
  throw "SHA-256 mismatch. Expected $ExpectedSha256 but got $actualSha256. Installation was not started."
}

$logPath = Join-Path $downloadRoot 'install.log'
$arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/LOG="' + $logPath + '"'))
$process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
if ($process.ExitCode -ne 0) { throw "Installer failed with exit code $($process.ExitCode). Review $logPath." }

$verify = Join-Path $env:ProgramFiles 'Abdo ERP Local\scripts\verify-lan-install.ps1'
if (-not (Test-Path -LiteralPath $verify)) { throw "Installation did not place the verifier at $verify. Review $logPath." }
& $verify
if (-not $?) { throw 'Installation verification failed.' }
Write-Host "Abdo ERP is ready at https://localhost/erp. Services start automatically with Windows."
