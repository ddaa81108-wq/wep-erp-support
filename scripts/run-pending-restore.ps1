$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\AbdoErpLocal'
$queue = "$root\restore"
$pending = "$queue\pending.json"
$processing = "$queue\processing.json"
if (-not (Test-Path -LiteralPath $pending)) { exit 0 }
$install = 'C:\Program Files\Abdo ERP Local'
$node = "$install\vendor\runtime\node-v24.16.0-win-x64\node.exe"
$live = "$root\data\abdo-erp.sqlite"
$rescue = $null
$stopped = $false
$replaced = $false
$backupTask = 'Abdo ERP Local Database Backup'
Move-Item -LiteralPath $pending -Destination $processing
try {
    $job = Get-Content -LiteralPath $processing -Raw | ConvertFrom-Json
    $candidate = [IO.Path]::GetFullPath($job.path)
    if (-not $candidate.StartsWith("$queue\restore-", [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($candidate) -ne 'database.sqlite') { throw 'Invalid restore path.' }
    if ((Get-FileHash -LiteralPath $candidate).Hash -ne $job.sha256) { throw 'Restore file changed after validation.' }
    & $node "$install\scripts\verify-database.mjs" $candidate --require-manifest
    if ($LASTEXITCODE) { throw 'Restore verification failed.' }
    Disable-ScheduledTask -TaskName $backupTask | Out-Null
    $deadline = (Get-Date).AddMinutes(2)
    while ((Get-ScheduledTask -TaskName $backupTask).State -eq 'Running') {
        if ((Get-Date) -gt $deadline) { throw 'Scheduled backup is still running. Restore cancelled.' }
        Start-Sleep -Seconds 2
    }
    $stopped = $true
    Stop-Service AbdoErpTunnel, AbdoErpLocalProxy
    Stop-Service AbdoErpLocal
    if (Get-NetTCPConnection -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue) { throw 'Application still running.' }
    New-Item -ItemType Directory -Path "$root\rescue-backups" -Force | Out-Null
    $rescueOutput = & $node "$install\scripts\backup-database.mjs" $live "$root\rescue-backups" 30
    if ($LASTEXITCODE) { throw 'Rescue backup failed. Live data was not changed.' }
    $rescue = ($rescueOutput | ConvertFrom-Json).outputPath
    if (-not $rescue -or -not (Test-Path -LiteralPath $rescue)) { throw 'Rescue backup not found.' }
    foreach ($suffix in @('-wal', '-shm')) {
        if (Test-Path -LiteralPath "$live$suffix") { Remove-Item -LiteralPath "$live$suffix" }
    }
    $replaced = $true
    Copy-Item -LiteralPath $candidate -Destination $live -Force
    # Restored sessions must not reactivate old logins.
    & $node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(process.argv[1]); db.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)"); db.close();' $live
    if ($LASTEXITCODE) { throw 'Session reset failed.' }
    Start-Service AbdoErpLocal
    $health = Invoke-RestMethod 'http://127.0.0.1:4310/api/health' -TimeoutSec 15
    if ($health.data.status -ne 'ready') { throw 'Restored server is not ready.' }
    Start-Service AbdoErpLocalProxy, AbdoErpTunnel
    $result = @{ success = $true; completedAt = (Get-Date).ToUniversalTime().ToString('o'); rescue = $rescue }
} catch {
    $failure = $_.Exception.Message
    if ($replaced -and $rescue) {
        Stop-Service AbdoErpLocal -Force -ErrorAction SilentlyContinue
        foreach ($suffix in @('-wal', '-shm')) {
            if (Test-Path -LiteralPath "$live$suffix") { Remove-Item -LiteralPath "$live$suffix" }
        }
        Copy-Item -LiteralPath $rescue -Destination $live -Force
    }
    $result = @{ success = $false; completedAt = (Get-Date).ToUniversalTime().ToString('o'); error = $failure; rescue = $rescue }
} finally {
    if ($stopped) { Start-Service AbdoErpLocal; Start-Service AbdoErpLocalProxy, AbdoErpTunnel }
    Enable-ScheduledTask -TaskName $backupTask | Out-Null
    if ($result) { [IO.File]::WriteAllText("$queue\last-result.json", ($result | ConvertTo-Json)) }
    Move-Item -LiteralPath $processing -Destination "$queue\last-request.json" -Force
}
if (-not $result.success) { exit 1 }
