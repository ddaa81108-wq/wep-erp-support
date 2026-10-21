$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = 'C:\Program Files\Abdo ERP Local'
$dataRoot = 'C:\ProgramData\AbdoErpLocal'
$snapshotRoot = Join-Path "$dataRoot\pre-update" ("security-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$backupTask = 'Abdo ERP Local Database Backup'
if (-not (Test-Path "$projectRoot\dist\tools\backup-database.mjs")) { throw 'Build the application first.' }
if ((Test-Path "$dataRoot\restore\pending.json") -or (Test-Path "$dataRoot\restore\processing.json")) { throw 'A restore is pending; deploy after it finishes.' }
$task = Get-ScheduledTask -TaskName $backupTask
if ($task.State -eq 'Running') { throw 'A backup is running; deploy after it finishes.' }
$backupEnabled = $task.Settings.Enabled
New-Item -ItemType Directory -Path $snapshotRoot -Force | Out-Null
& icacls.exe $snapshotRoot /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE) { throw 'Failed to protect update snapshot.' }
Copy-Item -LiteralPath "$installRoot\dist" -Destination "$snapshotRoot\dist" -Recurse
Copy-Item -LiteralPath "$dataRoot\services\AbdoErpLocal.xml" -Destination "$snapshotRoot\service.xml"
New-Item -ItemType Directory -Path "$snapshotRoot\scripts" | Out-Null
$scriptFiles = @('backup-database.mjs', 'run-scheduled-backup.ps1', 'verify-backup-task-admin.ps1', 'reset-restored-sessions.mjs')
foreach ($name in $scriptFiles) { Copy-Item -LiteralPath "$installRoot\scripts\$name" -Destination "$snapshotRoot\scripts\$name" }
function Wait-Ready {
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 2
            if ($health.data.status -eq 'ready') { return $health }
        } catch {}
        Start-Sleep -Seconds 1
    }
    throw 'Server did not become ready.'
}
$stopped = $false
$copied = $false
try {
    Disable-ScheduledTask -TaskName $backupTask | Out-Null
    $stopped = $true
    Stop-Service AbdoErpTunnel, AbdoErpLocalProxy
    Stop-Service AbdoErpLocal
    if (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue) { throw 'Application is still listening.' }
    Copy-Item -LiteralPath "$dataRoot\data\abdo-erp.sqlite" -Destination "$snapshotRoot\database.sqlite"
    foreach ($suffix in @('-wal', '-shm')) {
        if (Test-Path "$dataRoot\data\abdo-erp.sqlite$suffix") { Copy-Item -LiteralPath "$dataRoot\data\abdo-erp.sqlite$suffix" -Destination "$snapshotRoot\database.sqlite$suffix" }
    }
    & "$PSScriptRoot\initialize-security-admin.ps1"
    $copied = $true
    Copy-Item "$projectRoot\dist\*" "$installRoot\dist" -Recurse -Force
    Copy-Item -LiteralPath "$projectRoot\dist\tools\backup-database.mjs" -Destination "$installRoot\scripts\backup-database.mjs" -Force
    foreach ($name in $scriptFiles | Where-Object { $_ -ne 'backup-database.mjs' }) { Copy-Item -LiteralPath "$PSScriptRoot\$name" -Destination "$installRoot\scripts\$name" -Force }
    foreach ($relative in @('server\main.mjs', 'web\index.html', 'tools\backup-database.mjs')) {
        if ((Get-FileHash -LiteralPath "$projectRoot\dist\$relative").Hash -ne (Get-FileHash -LiteralPath "$installRoot\dist\$relative").Hash) { throw "Deployment copy mismatch: $relative" }
    }
    Start-Service AbdoErpLocal
    $health = Wait-Ready
    if ([int]$health.data.schemaVersion -ne 50) { throw 'Unexpected schema version.' }
    Start-Service AbdoErpLocalProxy, AbdoErpTunnel
    $stopped = $false
    $health | ConvertTo-Json -Depth 6
    Write-Output "Protected rollback snapshot: $snapshotRoot"
} catch {
    $failure = $_
    if ($stopped) {
        Stop-Service AbdoErpLocal -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath "$snapshotRoot\service.xml" -Destination "$dataRoot\services\AbdoErpLocal.xml" -Force
        if ($copied) {
            Copy-Item "$snapshotRoot\dist\*" "$installRoot\dist" -Recurse -Force
            Copy-Item "$snapshotRoot\scripts\*" "$installRoot\scripts" -Force
            foreach ($suffix in @('', '-wal', '-shm')) {
                $target = "$dataRoot\data\abdo-erp.sqlite$suffix"
                if (Test-Path "$snapshotRoot\database.sqlite$suffix") { Copy-Item -LiteralPath "$snapshotRoot\database.sqlite$suffix" -Destination $target -Force }
                elseif ($suffix -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target }
            }
        }
        Start-Service AbdoErpLocal
        [void](Wait-Ready)
        Start-Service AbdoErpLocalProxy, AbdoErpTunnel
    }
    throw $failure
} finally {
    if ($backupEnabled) { Enable-ScheduledTask -TaskName $backupTask | Out-Null }
}
