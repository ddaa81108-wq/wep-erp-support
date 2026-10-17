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

. (Join-Path $PSScriptRoot 'deployment-services.ps1')

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
if (-not (Test-Path -LiteralPath (Join-Path $installedDist 'server\main.mjs') -PathType Leaf)) {
  throw 'The previous installed server is missing. This script updates an existing installation only.'
}
if ($sourceDist.TrimEnd('\').Equals($installedDist.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Build source and installed program must be different directories.'
}

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
# Preflight runs before any service is stopped or installed file is moved.
$servicePlan = Get-DeploymentServicePlan
$servicesTouched = $false
$oldMoved = $false
$newInstalled = $false
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

  $servicesTouched = $true
  Stop-DeploymentServices $servicePlan
  if (Test-Path -LiteralPath $installedDist) {
    Move-Item -LiteralPath $installedDist -Destination $rollbackDist
    $oldMoved = $true
  }
  Move-Item -LiteralPath $stagingDist -Destination $installedDist
  $newInstalled = $true

  Start-DeploymentServices $servicePlan
  $health = Wait-AppHealth
  Assert-SameTree $sourceDist $installedDist | Out-Null
  # Keep the preceding program release for recovery; this contains program files only.
} catch {
  $failure = $_
  if ($oldMoved -or $newInstalled) {
    try {
      # Never replace a release while any of its services may still be using it.
      Stop-DeploymentServices $servicePlan
      if ($oldMoved -and -not (Test-Path -LiteralPath $rollbackDist -PathType Container)) {
        throw "Previous program release is missing: $rollbackDist"
      }
      if ($newInstalled -and (Test-Path -LiteralPath $installedDist)) {
        Remove-Item -LiteralPath $installedDist -Recurse -Force
      }
      if ($oldMoved) {
        Move-Item -LiteralPath $rollbackDist -Destination $installedDist
      }
      Start-DeploymentServices $servicePlan -RestoreOriginal
      if ($servicePlan.InitialRunning -contains 'AbdoErpLocal') {
        Wait-AppHealth 30 | Out-Null
      }
      Write-Warning 'Deployment failed; the previous program release and original running services were restored.'
    } catch {
      Write-Warning "Automatic recovery could not complete: $($_.Exception.Message). Preserve $rollbackDist."
    }
  } elseif ($servicesTouched) {
    # A failed stop must not trigger another stop attempt or a file replacement.
    try { Start-DeploymentServices $servicePlan -RestoreOriginal }
    catch { Write-Warning "Could not restore all original running services: $($_.Exception.Message)" }
  }
  throw $failure
} finally {
  if (Test-Path -LiteralPath $stagingDist) {
    try { Remove-Item -LiteralPath $stagingDist -Recurse -Force }
    catch { Write-Warning "Could not remove staging files: $stagingDist" }
  }
}

$serverHash = (Get-FileHash -LiteralPath (Join-Path $installedDist 'server\main.mjs') -Algorithm SHA256).Hash
$webIndexHash = (Get-FileHash -LiteralPath (Join-Path $installedDist 'web\index.html') -Algorithm SHA256).Hash
$deploymentResult = [pscustomobject]@{
  status = 'ok'
  deploymentMode = 'staged-with-rollback'
  previousProgramRelease = $(if ($oldMoved) { $rollbackDist } else { $null })
  services = @($servicePlan.StartOrder | ForEach-Object { Get-Service -Name $_ | Select-Object Name, Status })
  deployedAt = (Get-Date).ToUniversalTime().ToString('o')
  verifiedFiles = $manifest.Count
  serverSha256 = $serverHash
  webIndexSha256 = $webIndexHash
  apiVersion = $health.data.apiVersion
  schemaVersion = $health.data.schemaVersion
  uiVersion = $health.data.uiVersion
}
try {
  $deploymentResult | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath 'C:\ProgramData\AbdoErpLocal\logs\last-deployment.json' -Encoding utf8
} catch {
  Write-Warning "Program deployment succeeded, but its report could not be saved: $($_.Exception.Message)"
}
$deploymentResult
