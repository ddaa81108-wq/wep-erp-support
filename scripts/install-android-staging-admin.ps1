$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run as Administrator.' }
$state = Get-Content -LiteralPath (Join-Path $repo 'var\android-staging\current.json') -Raw | ConvertFrom-Json
$sandboxRoot = [IO.Path]::GetFullPath((Join-Path $repo 'var\android-staging')).TrimEnd('\') + '\'
$run = [IO.Path]::GetFullPath($state.run)
if (-not $run.StartsWith($sandboxRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid staging path.' }
$manifest = Get-Content -LiteralPath (Join-Path $run 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.synthetic -ne $true) { throw 'Not synthetic.' }
$server = Join-Path $run 'runtime\server\main.mjs'
$token = Join-Path $run 'tunnel-token.private'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
foreach ($path in @($server, $token, $cloudflared)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing staging prerequisite: $path" } }
$encoded = [IO.File]::ReadAllText($token).Trim().Replace('-', '+').Replace('_', '/')
$encoded = $encoded.PadRight($encoded.Length + ((4 - $encoded.Length % 4) % 4), '=')
$decoded = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded)) | ConvertFrom-Json
if ($decoded.t -ne '4b424b24-9c30-4798-9551-31860a974c60') { throw 'Token belongs to another tunnel.' }
$node = (Get-Command node.exe).Source
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$trigger = New-ScheduledTaskTrigger -AtStartup
$actions = @{
  AbdoErpAndroidStaging = New-ScheduledTaskAction -Execute $node -Argument ('"' + $server + '" "' + $run + '" --public') -WorkingDirectory $repo
  AbdoErpAndroidStagingTunnel = New-ScheduledTaskAction -Execute $cloudflared -Argument ('tunnel --no-autoupdate --logfile "' + (Join-Path $run 'tunnel.log') + '" run --token-file "' + $token + '"') -WorkingDirectory $repo
}
foreach ($name in $actions.Keys) {
  $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($existing -and $existing.Actions.Arguments -notlike "*$run*") { throw "Task $name belongs to another staging run; review it before replacing." }
  Register-ScheduledTask -TaskName $name -Action $actions[$name] -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Description 'Isolated synthetic Android staging; no production data.' -Force | Out-Null
}
$running = Get-CimInstance Win32_Process -Filter "ProcessId=$($state.pid)"
if ($running) {
  if ($running.CommandLine -notlike '*scripts/android-staging.ts*') { throw 'Refusing to stop an unrelated process.' }
  Stop-Process -Id $running.ProcessId -Force
}
Start-ScheduledTask -TaskName AbdoErpAndroidStaging
Start-ScheduledTask -TaskName AbdoErpAndroidStagingTunnel
Write-Output 'Both isolated staging startup tasks were registered and started. No production service was restarted.'
