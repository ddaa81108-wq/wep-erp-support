# Isolated deployment regression tests. No real Windows service is queried or changed.
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'deploy-built-admin.ps1'
$tokens = $null
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$source = [IO.File]::ReadAllText($scriptPath)
$start = $source.IndexOf('$identity =')
$end = $source.IndexOf('function Get-TreeManifest')
$source = $source.Substring(0, $start) + $source.Substring($end)
$helper = (Join-Path $PSScriptRoot 'deployment-services.ps1').Replace("'", "''")
$source = $source.Replace(". (Join-Path `$PSScriptRoot 'deployment-services.ps1')", ". '$helper'")
$source = $source.Replace("'C:\ProgramData\AbdoErpLocal\logs\last-deployment.json'", "(Join-Path `$InstallRoot 'last-deployment.json')")
# Keep simulated health failures fast; the production timeout remains unchanged.
$source = $source.Replace('[int]$TimeoutSeconds = 30', '[int]$TimeoutSeconds = 0')
$deploy = [scriptblock]::Create($source)
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('erp-deploy-test-' + [guid]::NewGuid().ToString('N'))

function Assert-Test($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-Service {
  param($Name, $ErrorAction)
  if ($script:fakeServices.ContainsKey($Name)) { return $script:fakeServices[$Name] }
  if ($ErrorAction -ne 'SilentlyContinue') { throw "Missing test service $Name" }
}
function Stop-Service {
  param($Name, [switch]$NoWait, $ErrorAction)
  $script:calls.Add("stop:$Name")
  if ($script:scenario -eq 'stop-failure' -and $Name -eq 'AbdoErpLocal') { throw 'Simulated stop refusal' }
  foreach ($child in $script:fakeServices[$Name].DependentServices) {
    if ($child.Status -ne 'Stopped') { throw "Dependent still running: $($child.Name)" }
  }
  $script:fakeServices[$Name].Status = 'Stopped'
}
function Start-Service {
  param($Name, $ErrorAction)
  $script:calls.Add("start:$Name")
  if ($script:scenario -eq 'start-failure' -and $Name -eq 'AbdoErpLocalProxy' -and -not $script:failedStart) {
    $script:failedStart = $true
    throw 'Simulated proxy start failure'
  }
  $script:fakeServices[$Name].Status = 'Running'
}
function Start-Sleep { param($Milliseconds) }
function Invoke-RestMethod {
  param($Uri, $TimeoutSec)
  if ($script:scenario -eq 'health-failure' -and (Get-Content -LiteralPath (Join-Path $script:install 'dist/server/main.mjs') -Raw) -eq 'new-server') {
    # The test copy uses a zero timeout; production still waits for recovery.
    throw 'Simulated health failure'
  }
  return @{ ok = $true; data = @{ apiVersion = '1'; schemaVersion = '47'; uiVersion = 'test' } }
}
function Invoke-WebRequest { param($Uri, $TimeoutSec, [switch]$UseBasicParsing) return @{ StatusCode = 200; Content = '<div id="root"></div>' } }
function Move-Item {
  param($LiteralPath, $Destination)
  if ($script:scenario -eq 'swap-failure' -and (Split-Path -Leaf $LiteralPath) -like '.deploy-staging-*') { throw 'Simulated staging rename failure' }
  Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
  if ($script:scenario -eq 'verification-failure' -and (Split-Path -Leaf $LiteralPath) -like '.deploy-staging-*') {
    [IO.File]::WriteAllText((Join-Path $Destination 'web/index.html'), 'corrupt-transfer')
  }
}

try {
  foreach ($script:scenario in @('success', 'no-tunnel', 'stop-failure', 'swap-failure', 'start-failure', 'health-failure', 'verification-failure', 'unknown-dependent', 'stopped-proxy')) {
    $root = Join-Path $testRoot $script:scenario
    $src = Join-Path $root 'source'
    $script:install = Join-Path $root 'installed'
    foreach ($folder in @('source/dist/server', 'source/dist/web', 'installed/dist/server', 'installed/dist/web', 'installed/data', 'installed/backups')) {
      New-Item -ItemType Directory -Path (Join-Path $root $folder) -Force | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $src 'dist/server/main.mjs'), 'new-server')
    [IO.File]::WriteAllText((Join-Path $src 'dist/web/index.html'), 'new-web')
    [IO.File]::WriteAllText((Join-Path $script:install 'dist/server/main.mjs'), 'old-server')
    [IO.File]::WriteAllText((Join-Path $script:install 'dist/web/index.html'), 'old-web')
    foreach ($file in @('data/database.sqlite', 'backups/backup.sqlite', 'settings.xml')) {
      [IO.File]::WriteAllText((Join-Path $script:install $file), 'preserve-exactly')
    }
    $script:calls = [Collections.Generic.List[string]]::new()
    $script:failedStart = $false
    $script:fakeServices = @{}
    foreach ($name in @('AbdoErpLocal', 'AbdoErpLocalProxy', 'AbdoErpTunnel')) {
      if ($script:scenario -eq 'no-tunnel' -and $name -eq 'AbdoErpTunnel') { continue }
      $service = [pscustomobject]@{ Name = $name; Status = 'Running'; StartType = 'Automatic'; DependentServices = @() }
      $service | Add-Member ScriptMethod Refresh {}
      $service | Add-Member ScriptMethod WaitForStatus { param($Status, $Timeout) if ($this.Status -ne $Status) { throw 'Simulated wait timeout' } }
      $script:fakeServices[$name] = $service
    }
    $script:fakeServices.AbdoErpLocal.DependentServices = @($script:fakeServices.Values | Where-Object Name -ne 'AbdoErpLocal')
    if ($script:scenario -eq 'unknown-dependent') {
      $script:fakeServices.AbdoErpLocal.DependentServices += [pscustomobject]@{ Name = 'UnrelatedService'; Status = 'Running' }
    }
    if ($script:scenario -eq 'stopped-proxy') { $script:fakeServices.AbdoErpLocalProxy.Status = 'Stopped' }
    $failure = $null
    try { & $deploy -SourceRoot $src -InstallRoot $script:install | Out-Null } catch { $failure = $_ }
    $success = $script:scenario -in @('success', 'no-tunnel', 'stopped-proxy')
    Assert-Test ($success -eq ($null -eq $failure)) "Unexpected result in $script:scenario : $failure"
    $expected = if ($success) { 'new-server' } else { 'old-server' }
    Assert-Test ((Get-Content -LiteralPath (Join-Path $script:install 'dist/server/main.mjs') -Raw) -eq $expected) "Wrong installed release in $script:scenario"
    foreach ($service in $script:fakeServices.Values) { Assert-Test ($service.Status -eq 'Running') "Service not recovered: $($service.Name)" }
    foreach ($file in @('data/database.sqlite', 'backups/backup.sqlite', 'settings.xml')) {
      Assert-Test ((Get-Content -LiteralPath (Join-Path $script:install $file) -Raw) -eq 'preserve-exactly') "Data changed: $file"
    }
    if ($script:scenario -eq 'success') {
      Assert-Test (($script:calls -join ',') -eq 'stop:AbdoErpTunnel,stop:AbdoErpLocalProxy,stop:AbdoErpLocal,start:AbdoErpLocal,start:AbdoErpLocalProxy,start:AbdoErpTunnel') 'Wrong service order'
    }
    if ($script:scenario -eq 'unknown-dependent') { Assert-Test ($script:calls.Count -eq 0) 'Preflight changed services' }
    Write-Host "PASS $script:scenario"
  }
} finally {
  $resolved = [IO.Path]::GetFullPath($testRoot)
  $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'erp-deploy-test-*') { throw 'Unsafe test cleanup path' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
