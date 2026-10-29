param(
  [string]$LocalUrl = 'http://127.0.0.1:4310',
  [string]$PublicUrl = 'https://vip2100.com',
  [string]$BackupDirectory = 'C:\ProgramData\AbdoErpLocal\backups',
  [string]$ReportDirectory = 'C:\ProgramData\AbdoErpLocal\logs\daily-safety',
  [ValidateRange(1,168)][int]$MaxBackupAgeHours = 26
)

# Read-only operational check. It never restarts services, touches the database,
# changes configuration, deletes files, or attempts a repair/restore.
$ErrorActionPreference = 'Stop'

function Test-Endpoint([string]$BaseUrl) {
  $uri = [Uri]($BaseUrl.TrimEnd('/') + '/api/health')
  if ($uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query) {
    throw "Invalid endpoint URL: $BaseUrl"
  }
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $response = Invoke-WebRequest -Uri $uri.AbsoluteUri -UseBasicParsing -TimeoutSec 20
    $health = $response.Content | ConvertFrom-Json
    $watch.Stop()
    [pscustomobject]@{
      Url = $uri.GetLeftPart([UriPartial]::Authority)
      Http = [int]$response.StatusCode
      Ready = ($response.StatusCode -eq 200 -and $health.ok -eq $true -and $health.data.status -eq 'ready')
      Milliseconds = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
      Commit = $health.data.build.commit
      Dirty = $health.data.build.dirty
    }
  } catch {
    $watch.Stop()
    [pscustomobject]@{
      Url = $uri.GetLeftPart([UriPartial]::Authority)
      Http = $null; Ready = $false
      Milliseconds = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
      Error = $_.Exception.GetType().Name
    }
  }
}

. (Join-Path $PSScriptRoot 'backup-status.ps1')

$services = @(Get-Service -Name 'AbdoErpLocal','AbdoErpLocalProxy','AbdoErpTunnel' -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ Name=$_.Name; Status=$_.Status.ToString(); StartType=$_.StartType.ToString() }
})
$serviceNames = @('AbdoErpLocal','AbdoErpLocalProxy','AbdoErpTunnel')
$servicesHealthy = @($serviceNames | ForEach-Object {
  $item = $services | Where-Object Name -eq $_ | Select-Object -First 1
  $null -ne $item -and $item.Status -eq 'Running'
}) -notcontains $false
$backup = Get-BackupStatus $BackupDirectory $MaxBackupAgeHours
$local = Test-Endpoint $LocalUrl
$public = if ($PublicUrl) { Test-Endpoint $PublicUrl } else { $null }
$overall = $servicesHealthy -and $local.Ready -and ($null -eq $public -or $public.Ready) -and $backup.Fresh -and $backup.LatestManifestValid

$report = [pscustomobject]@{
  CheckedAtUtc=[DateTime]::UtcNow.ToString('o')
  OverallOk=$overall
  Services=$services
  Local=$local
  Public=$public
  LocalBackups=$backup
  ReadOnly=$true
  Note='Read-only check only; no restart, repair, restore, database write, configuration change, or deletion was attempted.'
}

New-Item -ItemType Directory -Path $ReportDirectory -Force | Out-Null
$reportPath = Join-Path $ReportDirectory 'latest.json'
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
$report | ConvertTo-Json -Depth 8
if (-not $overall) { exit 2 }
