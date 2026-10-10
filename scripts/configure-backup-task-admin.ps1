param(
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')]
  [string]$DailyAt = '23:30',
  [ValidateRange(1, 365)]
  [int]$RetentionCount = 30,
  [switch]$Activate
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

$taskName = 'Abdo ERP Local Database Backup'
$node = 'C:\Program Files\Abdo ERP Local\vendor\runtime\node-v24.16.0-win-x64\node.exe'
$script = 'C:\Program Files\Abdo ERP Local\scripts\backup-database.mjs'
$sourceScript = Join-Path $PSScriptRoot 'backup-database.mjs'
$database = 'C:\ProgramData\AbdoErpLocal\data\abdo-erp.sqlite'
$output = 'C:\ProgramData\AbdoErpLocal\backups'

$plan = [pscustomobject]@{
  taskName = $taskName
  dailyAt = $DailyAt
  retentionCount = $RetentionCount
  database = $database
  output = $output
  activated = [bool]$Activate
}
if (-not $Activate) {
  $plan | ConvertTo-Json
  Write-Host 'Preview only. Run again with -Activate when real data entry starts.'
  exit 0
}

foreach ($path in @($node, $script, $database)) {
  if ($path -eq $script) { continue }
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $path" }
}
if (-not (Test-Path -LiteralPath $sourceScript -PathType Leaf)) { throw "Backup program is missing: $sourceScript" }
$installedScripts = Split-Path -Parent $script
New-Item -ItemType Directory -Path $installedScripts -Force | Out-Null
$stagedScript = "$script.new"
Copy-Item -LiteralPath $sourceScript -Destination $stagedScript -Force
if ((Get-FileHash -LiteralPath $sourceScript -Algorithm SHA256).Hash -ne
    (Get-FileHash -LiteralPath $stagedScript -Algorithm SHA256).Hash) {
  Remove-Item -LiteralPath $stagedScript -Force
  throw 'Backup program copy verification failed.'
}
Move-Item -LiteralPath $stagedScript -Destination $script -Force
New-Item -ItemType Directory -Path $output -Force | Out-Null
& icacls.exe $output /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to protect the backup directory.' }

$arguments = '"{0}" "{1}" "{2}" {3}' -f $script, $database, $output, $RetentionCount
$action = New-ScheduledTaskAction -Execute $node -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
$principalSettings = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principalSettings -Force | Out-Null
$plan | ConvertTo-Json
