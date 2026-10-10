param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

function Get-TreeManifest([string]$Root) {
  $resolved = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  return @(Get-ChildItem -LiteralPath $resolved -Recurse -File | ForEach-Object {
    [pscustomobject]@{
      Path = $_.FullName.Substring($resolved.Length + 1).Replace('\', '/')
      Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
  } | Sort-Object Path)
}

function Assert-SameTree([string]$ExpectedRoot, [string]$ActualRoot) {
  $expected = @(Get-TreeManifest $ExpectedRoot | Where-Object Path -Match '^(server|web)/')
  $actual = @(Get-TreeManifest $ActualRoot | Where-Object Path -Match '^(server|web)/')
  $actualByPath = @{}
  foreach ($item in $actual) { $actualByPath[$item.Path] = $item.Hash }
  # Extra immutable web assets from the immediately preceding release are allowed.
  # They keep already-open browser sessions working while the new release is swapped atomically.
  $difference = @($expected | Where-Object {
    -not $actualByPath.ContainsKey($_.Path) -or $actualByPath[$_.Path] -ne $_.Hash
  })
  if ($difference.Count -ne 0) {
    throw "Deployment tree verification failed with $($difference.Count) differences."
  }
  return $actual
}

function Start-AppServices {
  Start-Service -Name 'AbdoErpLocal'
  Start-Service -Name 'AbdoErpLocalProxy'
}

function Stop-AppServices {
  # Stop the HTTPS dependent first; Windows will refuse to stop the API while its dependent is running.
  foreach ($serviceName in @('AbdoErpLocalProxy', 'AbdoErpLocal')) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if (-not $service -or $service.Status -eq 'Stopped') { continue }

    & sc.exe stop $serviceName | Out-Null
    $deadline = (Get-Date).AddSeconds($(if ($serviceName -eq 'AbdoErpLocalProxy') { 8 } else { 20 }))
    do {
      Start-Sleep -Milliseconds 250
      $service.Refresh()
    } while ($service.Status -ne 'Stopped' -and (Get-Date) -lt $deadline)

    if ($service.Status -ne 'Stopped' -and $serviceName -eq 'AbdoErpLocalProxy') {
      $serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
      if ($serviceInfo.ProcessId -gt 0) {
        Stop-Process -Id $serviceInfo.ProcessId -Force -ErrorAction Stop
      }
      $service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(8))
    }

    if ($service.Status -ne 'Stopped') {
      throw "Service $serviceName did not stop safely before deployment."
    }
  }
}

function Wait-AppHealth([int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    Start-Sleep -Milliseconds 500
    try {
      $result = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 3
      if ($result.ok) {
        $shell = Invoke-WebRequest -Uri 'http://127.0.0.1:4310/erp' -TimeoutSec 5 -UseBasicParsing
        if ($shell.StatusCode -eq 200 -and $shell.Content -match '<div id="root"></div>') {
          return $result
        }
      }
    } catch {}
  } while ((Get-Date) -lt $deadline)
  throw 'The API and ERP application shell did not become healthy after deployment.'
}

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$sourceDist = Join-Path $SourceRoot 'dist'
$installedDist = Join-Path $InstallRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $sourceDist 'server\main.mjs'))) { throw 'Built server is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceDist 'web\index.html'))) { throw 'Built web client is missing.' }
if (-not (Test-Path -LiteralPath $InstallRoot)) { throw 'Installed application directory is missing.' }

$operationId = [Guid]::NewGuid().ToString('N')
$stagingDist = Join-Path $InstallRoot ".deploy-staging-$operationId"
$rollbackDist = Join-Path $InstallRoot ".deploy-rollback-$operationId"
$installPrefix = $InstallRoot.TrimEnd('\') + '\'
foreach ($path in @($installedDist, $stagingDist, $rollbackDist)) {
  $resolved = [IO.Path]::GetFullPath($path)
  if (-not $resolved.StartsWith($installPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Deployment path is outside the installation directory: $resolved"
  }
}
$swapped = $false
$health = $null

try {
  New-Item -ItemType Directory -Path $stagingDist -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceDist 'server') -Destination $stagingDist -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $sourceDist 'web') -Destination $stagingDist -Recurse -Force
  $previousAssets = Join-Path $installedDist 'web\assets'
  $stagedAssets = Join-Path $stagingDist 'web\assets'
  if (Test-Path -LiteralPath $previousAssets) {
    $assetCutoff = (Get-Date).AddDays(-2)
    Get-ChildItem -LiteralPath $previousAssets -File | Where-Object LastWriteTime -ge $assetCutoff | ForEach-Object {
      $destination = Join-Path $stagedAssets $_.Name
      if (-not (Test-Path -LiteralPath $destination)) {
        Copy-Item -LiteralPath $_.FullName -Destination $destination
      }
    }
  }
  $manifest = Assert-SameTree $sourceDist $stagingDist

  Stop-AppServices
  if (Test-Path -LiteralPath $installedDist) {
    Move-Item -LiteralPath $installedDist -Destination $rollbackDist
  }
  Move-Item -LiteralPath $stagingDist -Destination $installedDist
  $swapped = $true

  Start-AppServices
  $health = Wait-AppHealth
  Assert-SameTree $sourceDist $installedDist | Out-Null
  if (Test-Path -LiteralPath $rollbackDist) {
    Remove-Item -LiteralPath $rollbackDist -Recurse -Force
  }
} catch {
  $failure = $_
  Stop-AppServices
  if ($swapped -and (Test-Path -LiteralPath $rollbackDist)) {
    if (Test-Path -LiteralPath $installedDist) {
      Remove-Item -LiteralPath $installedDist -Recurse -Force
    }
    Move-Item -LiteralPath $rollbackDist -Destination $installedDist
  }
  if (Test-Path -LiteralPath $installedDist) {
    Start-AppServices
    try { Wait-AppHealth 20 | Out-Null } catch {}
  }
  throw $failure
} finally {
  if (Test-Path -LiteralPath $stagingDist) {
    Remove-Item -LiteralPath $stagingDist -Recurse -Force
  }
}

$serverHash = (Get-FileHash -LiteralPath (Join-Path $installedDist 'server\main.mjs') -Algorithm SHA256).Hash
$webIndexHash = (Get-FileHash -LiteralPath (Join-Path $installedDist 'web\index.html') -Algorithm SHA256).Hash
[pscustomobject]@{
  status = 'ok'
  deploymentMode = 'atomic-with-rollback'
  deployedAt = (Get-Date).ToUniversalTime().ToString('o')
  verifiedFiles = $manifest.Count
  serverSha256 = $serverHash
  webIndexSha256 = $webIndexHash
  apiVersion = $health.data.apiVersion
  schemaVersion = $health.data.schemaVersion
  uiVersion = $health.data.uiVersion
} | ConvertTo-Json | Set-Content -LiteralPath 'C:\ProgramData\AbdoErpLocal\logs\last-deployment.json' -Encoding utf8
