param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$DataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'var')
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Administrator privileges are required to install services, trust the CA, and configure the firewall.'
  }
}

function Escape-Xml([string]$Value) {
  return [Security.SecurityElement]::Escape($Value)
}

function Assert-LastExitCode([string]$Action) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Action failed with exit code $LASTEXITCODE"
  }
}

function Get-PemCertificateThumbprint([string]$Path) {
  $base64 = ((Get-Content -LiteralPath $Path) |
    Where-Object { $_ -notmatch '^-----' }) -join ''
  $bytes = [Convert]::FromBase64String($base64)
  $certificateObject = [Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes)
  try { return $certificateObject.Thumbprint } finally { $certificateObject.Dispose() }
}

Assert-Administrator

$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$runtimeRoot = Join-Path $InstallRoot 'vendor\runtime'
$node = Join-Path $runtimeRoot 'node-v24.16.0-win-x64\node.exe'
$caddy = Join-Path $runtimeRoot 'caddy.exe'
$mkcert = Join-Path $runtimeRoot 'mkcert.exe'
$winsw = Join-Path $runtimeRoot 'winsw.exe'
$serverEntry = Join-Path $InstallRoot 'dist\server\main.mjs'

foreach ($required in @($node, $caddy, $mkcert, $winsw, $serverEntry)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Required runtime file is missing: $required"
  }
}

$network = Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1
if (-not $network) { throw 'No active IPv4 LAN connection with a default gateway was found.' }
$profile = Get-NetConnectionProfile -InterfaceIndex $network.InterfaceIndex
if ($profile.NetworkCategory -notin @('Private', 'DomainAuthenticated')) {
  throw "The active network must be Private or domain-authenticated before opening HTTPS. Current profile: $($profile.NetworkCategory)"
}
$firewallProfile = if ($profile.NetworkCategory -eq 'DomainAuthenticated') { 'Domain' } else { 'Private' }
$lanIp = [string]$network.IPv4Address.IPAddress
$machineName = [Environment]::MachineName

$portConflict = Get-NetTCPConnection -State Listen -LocalPort 443 -ErrorAction SilentlyContinue |
  Select-Object -First 1
if ($portConflict) {
  $process = Get-Process -Id $portConflict.OwningProcess -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -notmatch 'caddy') {
    throw "TCP port 443 is already used by $($process.ProcessName) (PID $($process.Id))."
  }
}

$tlsRoot = Join-Path $DataRoot 'tls'
$caRoot = Join-Path $tlsRoot 'ca'
$serviceRoot = Join-Path $DataRoot 'services'
$logRoot = Join-Path $DataRoot 'logs'
$databaseRoot = Join-Path $DataRoot 'data'
$secretsRoot = Join-Path $DataRoot 'secrets'
$googleOAuthPath = Join-Path $secretsRoot 'google-oauth.json'
New-Item -ItemType Directory -Force -Path $tlsRoot, $caRoot, $serviceRoot, $logRoot, $databaseRoot, $secretsRoot | Out-Null

$googleOAuthEnvironment = ''
if (Test-Path -LiteralPath $googleOAuthPath) {
  $googleOAuth = Get-Content -Raw -LiteralPath $googleOAuthPath | ConvertFrom-Json
  if (-not $googleOAuth.clientId -or -not $googleOAuth.clientSecret) {
    throw "Google OAuth settings are incomplete: $googleOAuthPath"
  }
  $googleRedirectUri = if ($googleOAuth.redirectUri) {
    [string]$googleOAuth.redirectUri
  } else {
    'https://localhost/api/auth/google/callback'
  }
  $googleOAuthEnvironment = @"
  <env name="ABDO_GOOGLE_CLIENT_ID" value="$(Escape-Xml ([string]$googleOAuth.clientId))" />
  <env name="ABDO_GOOGLE_CLIENT_SECRET" value="$(Escape-Xml ([string]$googleOAuth.clientSecret))" />
  <env name="ABDO_GOOGLE_REDIRECT_URI" value="$(Escape-Xml $googleRedirectUri)" />
"@
}

$env:CAROOT = $caRoot
$certificate = Join-Path $tlsRoot 'abdo-erp-local.pem'
$privateKey = Join-Path $tlsRoot 'abdo-erp-local-key.pem'
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $mkcert -cert-file $certificate -key-file $privateKey localhost 127.0.0.1 ::1 $machineName $lanIp 2>&1 | Out-Host
$mkcertExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorActionPreference
if ($mkcertExitCode -ne 0) {
  throw "mkcert certificate generation failed with exit code $mkcertExitCode"
}
$rootCertificate = Join-Path $caRoot 'rootCA.pem'
$rootThumbprint = Get-PemCertificateThumbprint $rootCertificate
& certutil.exe -addstore -f Root $rootCertificate | Out-Host
Assert-LastExitCode 'local-machine CA trust installation'
[IO.File]::WriteAllText(
  (Join-Path $tlsRoot 'rootCA.thumbprint'),
  $rootThumbprint,
  [Text.UTF8Encoding]::new($false)
)
Copy-Item -LiteralPath $rootCertificate -Destination (Join-Path $tlsRoot 'abdo-local-rootCA.pem') -Force

& icacls.exe $tlsRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' "$env:USERNAME`:(OI)(CI)F" | Out-Null
Assert-LastExitCode 'TLS permissions'
& icacls.exe $secretsRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' "$env:USERNAME`:(OI)(CI)F" | Out-Null
Assert-LastExitCode 'secrets permissions'

$nodeServiceExe = Join-Path $serviceRoot 'AbdoErpLocal.exe'
$nodeServiceXml = Join-Path $serviceRoot 'AbdoErpLocal.xml'
$proxyServiceExe = Join-Path $serviceRoot 'AbdoErpLocalProxy.exe'
$proxyServiceXml = Join-Path $serviceRoot 'AbdoErpLocalProxy.xml'
$caddyFile = Join-Path $serviceRoot 'Caddyfile'
Copy-Item -LiteralPath $winsw -Destination $nodeServiceExe -Force
Copy-Item -LiteralPath $winsw -Destination $proxyServiceExe -Force

$nodeXml = @"
<service>
  <id>AbdoErpLocal</id>
  <name>Abdo ERP Local</name>
  <description>Local ERP API and SQLite owner process.</description>
  <executable>$(Escape-Xml $node)</executable>
  <arguments>--enable-source-maps &quot;$(Escape-Xml $serverEntry)&quot;</arguments>
  <workingdirectory>$(Escape-Xml $InstallRoot)</workingdirectory>
  <env name="ABDO_HOST" value="127.0.0.1" />
  <env name="ABDO_PORT" value="4310" />
  <env name="ABDO_DB_PATH" value="$(Escape-Xml (Join-Path $databaseRoot 'abdo-erp.sqlite'))" />
  <env name="ABDO_COOKIE_SECURE" value="true" />
$googleOAuthEnvironment
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>20 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <logpath>$(Escape-Xml $logRoot)</logpath>
  <log mode="roll-by-size-time">
    <sizeThreshold>10240</sizeThreshold>
    <pattern>yyyyMMdd</pattern>
    <autoRollAtTime>00:00:00</autoRollAtTime>
    <zipOlderThanNumDays>7</zipOlderThanNumDays>
    <zipDateFormat>yyyyMM</zipDateFormat>
  </log>
</service>
"@
[IO.File]::WriteAllText($nodeServiceXml, $nodeXml, [Text.UTF8Encoding]::new($false))

$certForCaddy = $certificate.Replace('\', '/')
$keyForCaddy = $privateKey.Replace('\', '/')
$caddyText = @"
{
  admin off
  auto_https off
}

:443 {
  tls "$certForCaddy" "$keyForCaddy"
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=15552000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
  }
  reverse_proxy 127.0.0.1:4310 {
    header_down -Strict-Transport-Security
    header_down -X-Content-Type-Options
    header_down -Referrer-Policy
    header_down -X-Frame-Options
  }
}
"@
[IO.File]::WriteAllText($caddyFile, $caddyText, [Text.UTF8Encoding]::new($false))

& $caddy validate --config $caddyFile --adapter caddyfile
Assert-LastExitCode 'Caddy configuration validation'

$proxyXml = @"
<service>
  <id>AbdoErpLocalProxy</id>
  <name>Abdo ERP Local HTTPS</name>
  <description>Private-LAN HTTPS endpoint for Abdo ERP Local and Abdo Cash.</description>
  <executable>$(Escape-Xml $caddy)</executable>
  <arguments>run --config &quot;$(Escape-Xml $caddyFile)&quot; --adapter caddyfile</arguments>
  <workingdirectory>$(Escape-Xml $InstallRoot)</workingdirectory>
  <depend>AbdoErpLocal</depend>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>20 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <logpath>$(Escape-Xml $logRoot)</logpath>
  <log mode="roll-by-size-time">
    <sizeThreshold>10240</sizeThreshold>
    <pattern>yyyyMMdd</pattern>
    <autoRollAtTime>00:00:00</autoRollAtTime>
    <zipOlderThanNumDays>7</zipOlderThanNumDays>
    <zipDateFormat>yyyyMM</zipDateFormat>
  </log>
</service>
"@
[IO.File]::WriteAllText($proxyServiceXml, $proxyXml, [Text.UTF8Encoding]::new($false))

foreach ($service in @(
  @{ Name = 'AbdoErpLocalProxy'; Wrapper = $proxyServiceExe },
  @{ Name = 'AbdoErpLocal'; Wrapper = $nodeServiceExe }
)) {
  if (Get-Service -Name $service.Name -ErrorAction SilentlyContinue) {
    & $service.Wrapper stop | Out-Host
    & $service.Wrapper uninstall | Out-Host
  }
}

& $nodeServiceExe install | Out-Host
Assert-LastExitCode 'Abdo ERP service installation'
& $proxyServiceExe install | Out-Host
Assert-LastExitCode 'HTTPS proxy service installation'

& (Join-Path $PSScriptRoot 'harden-windows-services-admin.ps1') -InstallRoot $InstallRoot -DataRoot $DataRoot | Out-Host

$firewallName = 'Abdo ERP Local HTTPS (Private LAN)'
Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
  -DisplayName $firewallName `
  -Direction Inbound `
  -Action Allow `
  -Enabled True `
  -Profile $firewallProfile `
  -Program $caddy `
  -Protocol TCP `
  -LocalPort 443 `
  -RemoteAddress LocalSubnet | Out-Null

Start-Service -Name 'AbdoErpLocal'
Start-Service -Name 'AbdoErpLocalProxy'

$healthUri = "https://$lanIp/api/health"
$deadline = [DateTime]::UtcNow.AddSeconds(45)
$health = $null
do {
  try {
    $health = Invoke-RestMethod -Uri $healthUri -TimeoutSec 5
  } catch {
    Start-Sleep -Seconds 2
  }
} until ($health -or [DateTime]::UtcNow -ge $deadline)
if (-not $health.ok) { throw "HTTPS health check failed: $healthUri" }

$result = [ordered]@{
  installedAt = [DateTime]::UtcNow.ToString('o')
  machineName = $machineName
  interface = $network.InterfaceAlias
  networkProfile = [string]$profile.NetworkCategory
  lanIp = $lanIp
  url = $healthUri.Replace('/api/health', '')
  healthUrl = $healthUri
  rootCertificate = (Join-Path $tlsRoot 'abdo-local-rootCA.pem')
  database = (Join-Path $databaseRoot 'abdo-erp.sqlite')
}
[IO.File]::WriteAllText(
  (Join-Path $DataRoot 'lan-config.json'),
  ($result | ConvertTo-Json),
  [Text.UTF8Encoding]::new($false)
)
$result | ConvertTo-Json
