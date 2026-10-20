param(
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
  [string]$DataRoot = 'C:\ProgramData\AbdoErpLocal',
  [string]$ReportCopyPath = '',
  [string]$PublicUrl = ''
)

$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath (Join-Path $DataRoot 'lan-config.json')) {
  & (Join-Path $PSScriptRoot 'verify-lan-install.ps1') -InstallRoot $InstallRoot -DataRoot $DataRoot -ReportCopyPath $ReportCopyPath
  return
}

# A tunnel installation does not use the LAN certificate/firewall configuration.
# Require the tunnel instead of silently skipping a missing LAN configuration.
$services = @('AbdoErpLocal', 'AbdoErpLocalProxy', 'AbdoErpTunnel') | ForEach-Object {
  $service = Get-Service -Name $_ -ErrorAction Stop
  if ($service.Status -ne 'Running') { throw "Service is not running: $_" }
  $service | Select-Object Name, Status
}
$health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 10
if (-not $health.ok -or $health.data.status -ne 'ready') { throw 'Installed API is not ready.' }
$page = Invoke-WebRequest 'http://127.0.0.1:4310/erp' -UseBasicParsing -TimeoutSec 10
$installedHtml = [IO.File]::ReadAllText((Join-Path $InstallRoot 'dist\web\index.html'))
if ($page.StatusCode -ne 200 -or $page.Content -ne $installedHtml -or $page.Content -notmatch '<div id="root"></div>') {
  throw 'Served application shell does not match the installed release.'
}
$publicStatus = $null
if ($PublicUrl) {
  if ($PublicUrl -notmatch '^https://') { throw 'Public verification requires HTTPS.' }
  $publicPage = Invoke-WebRequest $PublicUrl -UseBasicParsing -TimeoutSec 30
  # Cloudflare may inject its own scripts; compare the application's immutable assets.
  $assets = @([regex]::Matches($installedHtml, '(?:src|href)="(/assets/[^"\s]+)"') | ForEach-Object { $_.Groups[1].Value })
  $missingAssets = @($assets | Where-Object { -not $publicPage.Content.Contains($_) })
  if ($publicPage.StatusCode -ne 200 -or $assets.Count -eq 0 -or $missingAssets.Count -ne 0 -or $publicPage.Content -notmatch '<div id="root"></div>') {
    throw 'Public application shell does not match the installed release.'
  }
  $publicStatus = $publicPage.StatusCode
}
$report = [ordered]@{
  verifiedAt = [DateTime]::UtcNow.ToString('o')
  mode = 'cloudflare-tunnel'
  health = $health.data.status
  build = $health.data.build
  services = $services
  installedShellMatches = $true
  publicUrl = $PublicUrl
  publicStatus = $publicStatus
}
$json = $report | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $DataRoot 'verification-report.json'), $json, [Text.UTF8Encoding]::new($false))
if ($ReportCopyPath) { [IO.File]::WriteAllText($ReportCopyPath, $json, [Text.UTF8Encoding]::new($false)) }
$json
