param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$TaskName = 'VIB Abdo Company - Daily Read-only Safety Check',
  [ValidateRange(0,23)][int]$Hour = 6,
  [ValidateRange(0,59)][int]$Minute = 10
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this registration script in an elevated PowerShell window.'
}
$script = Join-Path ([IO.Path]::GetFullPath($ProjectRoot)) 'scripts\daily-readonly-safety-check.ps1'
if (-not (Test-Path -LiteralPath $script -PathType Leaf)) { throw "Safety check script is missing: $script" }
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At ([DateTime]::Today.AddHours($Hour).AddMinutes($Minute))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Read-only daily service, health, endpoint and local backup check.' -Force | Select-Object TaskName, State
