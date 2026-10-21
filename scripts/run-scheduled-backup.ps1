$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\AbdoErpLocal'
$node = 'C:\Program Files\Abdo ERP Local\vendor\runtime\node-v24.16.0-win-x64\node.exe'
$script = 'C:\Program Files\Abdo ERP Local\scripts\backup-database.mjs'
$statusPath = "$root\backup-schedule.json"
$status = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
try {
    $backupKey = "$root\secrets\backup-encryption.key"
    if (-not (Test-Path -LiteralPath $backupKey -PathType Leaf)) { throw 'Backup encryption key is missing.' }
    & $node $script "$root\data\abdo-erp.sqlite" $status.output $status.retentionCount $backupKey
    if ($LASTEXITCODE) { throw 'Backup validation failed.' }
    $manifest = Get-ChildItem -LiteralPath $status.output -Filter 'abdo-erp-*.abdobackup.json' |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $verified = Get-Content -LiteralPath $manifest.FullName -Raw | ConvertFrom-Json
    $status.lastSuccess = $verified.createdAt
    $status.lastFile = $verified.file
    $status.lastError = $null
} catch {
    $status.lastError = $_.Exception.Message
    throw
} finally {
    $temporary = "$statusPath.tmp"
    [IO.File]::WriteAllText($temporary, ($status | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $statusPath -Force
    & icacls.exe $statusPath /grant 'NT SERVICE\AbdoErpLocal:R' | Out-Null
}
