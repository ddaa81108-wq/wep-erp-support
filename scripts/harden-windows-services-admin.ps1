param(
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
  [string]$DataRoot = 'C:\ProgramData\AbdoErpLocal'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

$apiService = 'AbdoErpLocal'
$proxyService = 'AbdoErpLocalProxy'
$apiIdentity = "NT SERVICE\$apiService"
$proxyIdentity = "NT SERVICE\$proxyService"
$dataPath = Join-Path $DataRoot 'data'
$logsPath = Join-Path $DataRoot 'logs'
$tlsPath = Join-Path $DataRoot 'tls'
$secretsPath = Join-Path $DataRoot 'secrets'
$servicesPath = Join-Path $DataRoot 'services'
$backupsPath = Join-Path $DataRoot 'backups'
$apiFiles = @(
  (Join-Path $servicesPath 'AbdoErpLocal.exe'),
  (Join-Path $servicesPath 'AbdoErpLocal.xml')
)
$proxyFiles = @(
  (Join-Path $servicesPath 'AbdoErpLocalProxy.exe'),
  (Join-Path $servicesPath 'AbdoErpLocalProxy.xml'),
  (Join-Path $servicesPath 'Caddyfile')
)

if (-not (Test-Path -LiteralPath $backupsPath)) { New-Item -ItemType Directory -Path $backupsPath | Out-Null }
foreach ($path in @($InstallRoot, $DataRoot, $dataPath, $logsPath, $tlsPath, $secretsPath, $servicesPath, $backupsPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required path is missing: $path" }
}

$protectedPaths = @($DataRoot, $dataPath, $logsPath, $tlsPath, $secretsPath, $servicesPath, $backupsPath) + $apiFiles + $proxyFiles
$aclBackup = @{}
foreach ($path in $protectedPaths) {
  if (Test-Path -LiteralPath $path) { $aclBackup[$path] = Get-Acl -LiteralPath $path }
}

function Set-AclExact([string]$Path, [string[]]$Rules) {
  & icacls.exe $Path /inheritance:r /grant:r $Rules | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to secure ACL: $Path" }
}

function Configure-ServiceIdentity([string]$Name, [string]$Account) {
  $output = & sc.exe config $Name obj= $Account 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Unable to configure service identity $Name`: $output" }
}

$originalApiIdentity = (Get-CimInstance Win32_Service -Filter "Name='$apiService'").StartName
$originalProxyIdentity = (Get-CimInstance Win32_Service -Filter "Name='$proxyService'").StartName
if (-not $originalApiIdentity -or -not $originalProxyIdentity) { throw 'Unable to read the current service identities.' }

Stop-Service -Name $proxyService -Force -ErrorAction SilentlyContinue
Stop-Service -Name $apiService -Force -ErrorAction SilentlyContinue

try {
  Configure-ServiceIdentity $apiService $apiIdentity
  Configure-ServiceIdentity $proxyService $proxyIdentity

  Set-AclExact $DataRoot @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F', "$apiIdentity`:RX", "$proxyIdentity`:RX")
  Set-AclExact $dataPath @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F', "$apiIdentity`:(OI)(CI)M")
  Set-AclExact $logsPath @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F', "$apiIdentity`:(OI)(CI)M", "$proxyIdentity`:(OI)(CI)M")
  Set-AclExact $tlsPath @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F', "$proxyIdentity`:(OI)(CI)RX")
  Set-AclExact $secretsPath @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F')
  Set-AclExact $backupsPath @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F')
  Set-AclExact $servicesPath @('SYSTEM:(OI)(CI)F', 'Administrators:(OI)(CI)F', "$apiIdentity`:RX", "$proxyIdentity`:RX")

  foreach ($path in $apiFiles) { & icacls.exe $path /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' "$apiIdentity`:RX" | Out-Null }
  foreach ($path in $proxyFiles) { & icacls.exe $path /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' "$proxyIdentity`:RX" | Out-Null }

  Start-Service -Name $apiService
  (Get-Service -Name $apiService).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  Start-Service -Name $proxyService
  (Get-Service -Name $proxyService).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 3 } catch { $health = $null }
  } while (-not $health.ok -and (Get-Date) -lt $deadline)
  if (-not $health.ok) { throw 'API health check failed after service hardening.' }
  $shell = Invoke-WebRequest -Uri 'http://127.0.0.1:4310/erp' -TimeoutSec 5 -UseBasicParsing
  if ($shell.StatusCode -ne 200) { throw 'ERP shell check failed after service hardening.' }
  $node = Join-Path $InstallRoot 'vendor\runtime\node-v24.16.0-win-x64\node.exe'
  $httpsVerifier = Join-Path $PSScriptRoot 'verify-https.mjs'
  & $node $httpsVerifier 'https://localhost/erp' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'HTTPS check failed after service hardening.' }
} catch {
  Configure-ServiceIdentity $apiService $originalApiIdentity
  Configure-ServiceIdentity $proxyService $originalProxyIdentity
  foreach ($path in $aclBackup.Keys) {
    try { Set-Acl -LiteralPath $path -AclObject $aclBackup[$path] } catch {}
  }
  Start-Service -Name $apiService -ErrorAction SilentlyContinue
  Start-Service -Name $proxyService -ErrorAction SilentlyContinue
  throw
}

[pscustomobject]@{
  status = 'ok'
  apiServiceAccount = $apiIdentity
  proxyServiceAccount = $proxyIdentity
  databaseAclProtected = $true
  backupAclProtected = $true
  httpsVerified = $true
  health = $health.data.status
} | ConvertTo-Json
