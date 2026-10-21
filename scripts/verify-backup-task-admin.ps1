param(
  [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

$taskName = 'Abdo ERP Local Database Backup'
$backupRoot = 'C:\ProgramData\AbdoErpLocal\backups'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
if (-not $task.Settings.Enabled) { throw 'Backup task is disabled.' }

$startedAt = Get-Date
Start-ScheduledTask -TaskName $taskName
$deadline = (Get-Date).AddMinutes(2)
do {
  Start-Sleep -Milliseconds 500
  $task = Get-ScheduledTask -TaskName $taskName
  if ((Get-Date) -gt $deadline) { throw 'Backup task verification timed out.' }
} while ($task.State -eq 'Running')

$info = Get-ScheduledTaskInfo -TaskName $taskName
if ($info.LastTaskResult -ne 0) { throw "Backup task failed with result $($info.LastTaskResult)." }
$backup = Get-ChildItem -LiteralPath $backupRoot -Filter '*.abdobackup' -File |
  Where-Object LastWriteTime -ge $startedAt.AddSeconds(-2) |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $backup) { throw 'The scheduled task did not create a new backup.' }
$manifestPath = "$($backup.FullName).json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Backup manifest is missing.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$actualHash = (Get-FileHash -LiteralPath $backup.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -ne [string]$manifest.sha256) { throw 'Backup hash verification failed.' }
if ([string]$manifest.integrity -ne 'ok' -or [int]$manifest.foreignKeyProblems -ne 0) {
  throw 'Backup database validation failed.'
}

$report = [pscustomobject]@{
  status = 'ok'
  taskName = $taskName
  state = [string]$task.State
  runAs = [string]$task.Principal.UserId
  nextRunTime = $info.NextRunTime
  lastRunTime = $info.LastRunTime
  lastTaskResult = $info.LastTaskResult
  backupFile = $backup.Name
  backupSizeBytes = $backup.Length
  schemaVersion = [int]$manifest.schemaVersion
  integrity = [string]$manifest.integrity
  foreignKeyProblems = [int]$manifest.foreignKeyProblems
  sha256Verified = $true
}
if ($ReportPath) {
  $parent = Split-Path -Parent $ReportPath
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ReportPath -Encoding utf8
}
$report | ConvertTo-Json -Depth 4
