param(
    [string]$DataRoot = 'C:\ProgramData\AbdoErpLocal',
    [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
    [string]$NodePath = ''
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($DataRoot)
$queue = Join-Path $root 'restore'
if (-not (Test-Path -LiteralPath $queue)) { exit 0 }
# The OS releases this exclusive handle after a crash; a second worker cannot
# mistake an active processing job for an interrupted one.
try { $workerLock = [IO.File]::Open("$queue\worker.lock", [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch [IO.IOException] { exit 0 }
$pending = "$queue\pending.json"
$processing = "$queue\processing.json"
$journal = "$queue\journal.json"
$backupTask = 'Abdo ERP Local Database Backup'
$node = if ($NodePath) { $NodePath } else { "$InstallRoot\vendor\runtime\node-v24.16.0-win-x64\node.exe" }
$live = "$root\data\abdo-erp.sqlite"
function File-Hash($Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}
function Save-Json($Path, $Value) {
    [IO.File]::WriteAllText("$Path.tmp", ($Value | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath "$Path.tmp" -Destination $Path -Force
}
function Wait-Api {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 2
            if ($health.data.status -eq 'ready') { return $health }
        } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw 'Application did not become ready within 60 seconds.'
}
function Stop-App {
    Stop-Service AbdoErpTunnel, AbdoErpLocalProxy
    Stop-Service AbdoErpLocal
    if (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue) { throw 'Application still running.' }
}
function Start-App {
    Start-Service AbdoErpLocal
    [void](Wait-Api)
    Start-Service AbdoErpLocalProxy, AbdoErpTunnel
}
function Clear-Sidecars {
    foreach ($suffix in @('-wal', '-shm')) {
        if (Test-Path -LiteralPath "$live$suffix") { Remove-Item -LiteralPath "$live$suffix" }
    }
}
# Interrupted replacements require review, never an automatic destructive replay.
if (Test-Path -LiteralPath $processing) {
    $state = if (Test-Path -LiteralPath $journal) { Get-Content $journal -Raw | ConvertFrom-Json } else { $null }
    if ($state -and $state.phase -eq 'complete') {
        if ($state.backupEnabled) { Enable-ScheduledTask -TaskName $backupTask | Out-Null }
        Move-Item -LiteralPath $processing -Destination "$queue\last-request.json" -Force
        exit 0
    }
    $needsReview = $state -and $state.phase -eq 'replacing'
    if ($state -and $state.phase -eq 'validated') {
        try { Start-App } catch { $needsReview = $true }
    }
    Save-Json "$queue\last-result.json" @{ success=$false; completedAt=(Get-Date).ToUniversalTime().ToString('o'); error='Previous restore was interrupted. Review the journal and rescue backup before retrying.'; needsReview=[bool]$needsReview; rescue=$state.rescue }
    if ($needsReview) { Save-Json "$queue\recovery-required.json" @{ rescue=$state.rescue; phase=$state.phase } }
    Move-Item -LiteralPath $processing -Destination "$queue\last-request.json" -Force
    if ($state -and $state.backupEnabled) { Enable-ScheduledTask -TaskName $backupTask | Out-Null }
    exit 1
}
if (-not (Test-Path -LiteralPath $pending)) { exit 0 }
if (Test-Path -LiteralPath "$queue\recovery-required.json") { throw 'Manual recovery review is required.' }
$rescue = $null
$stopped = $false
$replaced = $false
$backupEnabled = (Get-ScheduledTask -TaskName $backupTask).Settings.Enabled
$result = $null
Save-Json $journal @{ phase='claimed'; backupEnabled=$backupEnabled; rescue=$null }
Move-Item -LiteralPath $pending -Destination $processing
try {
    $job = Get-Content -LiteralPath $processing -Raw | ConvertFrom-Json
    $candidate = [IO.Path]::GetFullPath($job.path)
    $parent = Split-Path -Parent $candidate
    if ((Split-Path -Parent $parent) -ne $queue -or (Split-Path -Leaf $parent) -notmatch '^restore-[A-Za-z0-9]+$' -or
        [IO.Path]::GetFileName($candidate) -ne 'database.sqlite' -or
        ((Get-Item -LiteralPath $parent).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        ((Get-Item -LiteralPath $candidate).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid restore path.' }
    if ((File-Hash $candidate) -ne $job.sha256) { throw 'Restore file changed after validation.' }
    & $node "$InstallRoot\scripts\verify-database.mjs" $candidate --require-manifest
    if ($LASTEXITCODE) { throw 'Restore verification failed.' }
    Save-Json $journal @{ phase='validated'; backupEnabled=$backupEnabled; rescue=$null }
    Disable-ScheduledTask -TaskName $backupTask | Out-Null
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-ScheduledTask -TaskName $backupTask).State -eq 'Running') {
        if ((Get-Date) -gt $deadline) { throw 'Scheduled backup is still running. Restore cancelled.' }
        Start-Sleep -Seconds 2
    }
    $stopped = $true
    Stop-App
    New-Item -ItemType Directory -Path "$root\rescue-backups" -Force | Out-Null
    $rescueOutput = & $node "$InstallRoot\scripts\backup-database.mjs" $live "$root\rescue-backups" 30
    if ($LASTEXITCODE) { throw 'Rescue backup failed. Live data was not changed.' }
    $rescue = ($rescueOutput | ConvertFrom-Json).outputPath
    if (-not $rescue -or -not (Test-Path -LiteralPath $rescue)) { throw 'Rescue backup not found.' }
    Save-Json $journal @{ phase='replacing'; backupEnabled=$backupEnabled; rescue=$rescue }
    Copy-Item -LiteralPath $candidate -Destination "$live.restore" -Force
    Clear-Sidecars
    $replaced = $true
    Move-Item -LiteralPath "$live.restore" -Destination $live -Force
    & $node "$InstallRoot\scripts\reset-restored-sessions.mjs" $live
    if ($LASTEXITCODE) { throw 'Session reset failed.' }
    Start-App
    $stopped = $false
    $result = @{ success=$true; completedAt=(Get-Date).ToUniversalTime().ToString('o'); rescue=$rescue }
    Save-Json "$queue\last-result.json" $result
    Save-Json $journal @{ phase='complete'; backupEnabled=$backupEnabled; rescue=$rescue }
} catch {
    $failure = $_.Exception.Message
    try {
        if ($replaced -and $rescue) {
            Stop-App
            Clear-Sidecars
            Copy-Item -LiteralPath $rescue -Destination "$live.restore" -Force
            Move-Item -LiteralPath "$live.restore" -Destination $live -Force
        }
        if ($stopped) { Start-App; $stopped=$false }
        $result = @{ success=$false; completedAt=(Get-Date).ToUniversalTime().ToString('o'); error=$failure; rescue=$rescue }
    } catch {
        Save-Json "$queue\recovery-required.json" @{ rescue=$rescue; error=$_.Exception.Message }
        $result = @{ success=$false; completedAt=(Get-Date).ToUniversalTime().ToString('o'); error=$failure; needsReview=$true; rescue=$rescue }
    }
} finally {
    try { if ($backupEnabled) { Enable-ScheduledTask -TaskName $backupTask | Out-Null } }
    finally {
        if ($result) { Save-Json "$queue\last-result.json" $result }
        Move-Item -LiteralPath $processing -Destination "$queue\last-request.json" -Force
    }
}
if (-not $result.success) { exit 1 }
