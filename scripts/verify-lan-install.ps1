param(
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
  [string]$DataRoot = 'C:\ProgramData\AbdoErpLocal',
  [string]$ReportCopyPath = ''
)

$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $DataRoot 'lan-config.json') -Raw | ConvertFrom-Json
$services = Get-CimInstance Win32_Service |
  Where-Object { $_.Name -in @('AbdoErpLocal', 'AbdoErpLocalProxy') } |
  Select-Object Name, State, StartMode, PathName
if ($services.Count -ne 2 -or ($services | Where-Object State -ne 'Running')) {
  throw 'Both Windows services must be installed and running.'
}

$firewallName = 'Abdo ERP Local HTTPS (Private LAN)'
$firewall = Get-NetFirewallRule -DisplayName $firewallName
$port = $firewall | Get-NetFirewallPortFilter
$address = $firewall | Get-NetFirewallAddressFilter
$expectedProfile = if ($config.networkProfile -eq 'DomainAuthenticated') { 'Domain' } else { 'Private' }
if (
  $firewall.Enabled -ne 'True' -or
  $firewall.Direction -ne 'Inbound' -or
  $firewall.Action -ne 'Allow' -or
  [string]$firewall.Profile -ne $expectedProfile -or
  $port.Protocol -ne 'TCP' -or
  [string]$port.LocalPort -ne '443' -or
  [string]$address.RemoteAddress -ne 'LocalSubnet'
) {
  throw 'The LAN HTTPS firewall rule is not restricted as expected.'
}

$thumbprint = (Get-Content -LiteralPath (Join-Path $DataRoot 'tls\rootCA.thumbprint') -Raw).Trim()
$trustedRoot = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $thumbprint
if (-not $trustedRoot) { throw 'The local CA is not trusted in the LocalMachine root store.' }

$health = Invoke-RestMethod -Uri $config.healthUrl -TimeoutSec 10
if (-not $health.ok -or $health.data.status -ne 'ready') { throw 'The HTTPS health endpoint is not ready.' }
$page = Invoke-WebRequest -Uri $config.url -TimeoutSec 10 -UseBasicParsing
if (
  $page.StatusCode -ne 200 -or
  $page.Content -notmatch '<html lang="ar" dir="rtl">' -or
  $page.Content -notmatch '<div id="root"></div>' -or
  $page.Content -notmatch '/assets/[^"'']+\.js'
) {
  throw 'The HTTPS Arabic application shell did not pass verification.'
}

$sqlite = Join-Path $InstallRoot 'vendor\runtime\sqlite3.exe'
$databaseCheck = (& $sqlite $config.database 'PRAGMA quick_check;').Trim()
if ($databaseCheck -ne 'ok') { throw "SQLite quick_check failed: $databaseCheck" }

$report = [ordered]@{
  verifiedAt = [DateTime]::UtcNow.ToString('o')
  url = $config.url
  health = $health.data.status
  uiVersion = $health.data.uiVersion
  services = $services
  firewall = [ordered]@{
    enabled = [string]$firewall.Enabled
    profile = [string]$firewall.Profile
    direction = [string]$firewall.Direction
    action = [string]$firewall.Action
    protocol = [string]$port.Protocol
    localPort = [string]$port.LocalPort
    remoteAddress = [string]$address.RemoteAddress
  }
  certificate = [ordered]@{
    thumbprint = $trustedRoot.Thumbprint
    subject = $trustedRoot.Subject
    notAfter = $trustedRoot.NotAfter.ToString('o')
    phoneRootCertificate = $config.rootCertificate
  }
  databaseQuickCheck = $databaseCheck
}
$reportJson = $report | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $DataRoot 'verification-report.json'), $reportJson, [Text.UTF8Encoding]::new($false))
if ($ReportCopyPath) {
  [IO.File]::WriteAllText($ReportCopyPath, $reportJson, [Text.UTF8Encoding]::new($false))
}
$report | ConvertTo-Json -Depth 8
