param(
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [switch]$ConfirmRestore,
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
  [string]$DataRoot = 'C:\ProgramData\AbdoErpLocal'
)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmRestore) { throw 'Restore requires the explicit -ConfirmRestore switch.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator privileges are required.'
}

$backup = [IO.Path]::GetFullPath($BackupPath)
$manifest = "$backup.json"
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw "Backup file is missing: $backup" }
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw "Backup manifest is missing: $manifest" }
$node = Join-Path $InstallRoot 'vendor\runtime\node-v24.16.0-win-x64\node.exe'
$verifier = Join-Path $PSScriptRoot 'verify-database.mjs'
$httpsVerifier = Join-Path $PSScriptRoot 'verify-https.mjs'
if (-not (Test-Path -LiteralPath $node)) { throw 'Bundled Node.js runtime is missing.' }
if (-not (Test-Path -LiteralPath $verifier)) { throw 'Database verifier is missing.' }
if (-not (Test-Path -LiteralPath $httpsVerifier)) { throw 'HTTPS verifier is missing.' }

$databaseRoot = Join-Path $DataRoot 'data'
$database = Join-Path $databaseRoot 'abdo-erp.sqlite'
if ($backup -eq [IO.Path]::GetFullPath($database)) { throw 'The live database cannot be used as its own restore source.' }

try { $currentHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 5 } catch {
  throw 'The current API health and schema version must be readable before restore.'
}
if (-not $currentHealth.ok) { throw 'The current API is not healthy enough to begin restore.' }
$currentSchemaVersion = [int]$currentHealth.data.schemaVersion

$verificationOutput = & $node $verifier $backup '--require-manifest'
$verificationExitCode = $LASTEXITCODE
$verified = $verificationOutput | ConvertFrom-Json
if ($verificationExitCode -ne 0 -or -not $verified.ok) {
  $verificationError = if ($verified.error) { $verified.error } else { $verificationOutput }
  throw "Backup verification failed: $verificationError"
}
if (-not $verified.manifestVerified -or $verified.integrity -ne 'ok' -or [int]$verified.foreignKeyProblems -ne 0) {
  throw 'Backup manifest, integrity, or relations are invalid.'
}
if ([int]$verified.schemaVersion -gt $currentSchemaVersion) {
  throw "Backup schema $($verified.schemaVersion) is newer than installed schema $currentSchemaVersion."
}

$recoveryRoot = Join-Path $DataRoot ('restore-recovery\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $recoveryRoot | Out-Null
$recoveryDatabase = Join-Path $recoveryRoot 'abdo-erp.sqlite'
$replaced = $false

Stop-Service -Name 'AbdoErpLocalProxy' -Force -ErrorAction SilentlyContinue
Stop-Service -Name 'AbdoErpLocal' -Force
try {
  Copy-Item -LiteralPath $database -Destination $recoveryDatabase -Force
  foreach ($suffix in @('-wal', '-shm')) {
    $sidecar = "$database$suffix"
    if (Test-Path -LiteralPath $sidecar) { Copy-Item -LiteralPath $sidecar -Destination "$recoveryDatabase$suffix" -Force }
  }
  $recoveryOutput = & $node $verifier $recoveryDatabase
  $recoveryExitCode = $LASTEXITCODE
  $recoveryVerified = $recoveryOutput | ConvertFrom-Json
  if ($recoveryExitCode -ne 0 -or -not $recoveryVerified.ok) {
    throw 'The pre-restore recovery copy failed verification; restore was cancelled.'
  }

  Copy-Item -LiteralPath $backup -Destination "$database.restore" -Force
  $stagedOutput = & $node $verifier "$database.restore"
  $stagedExitCode = $LASTEXITCODE
  $staged = $stagedOutput | ConvertFrom-Json
  if ($stagedExitCode -ne 0 -or -not $staged.ok) { throw 'The staged database failed verification.' }

  Move-Item -LiteralPath "$database.restore" -Destination $database -Force
  Remove-Item -LiteralPath "$database-wal", "$database-shm" -Force -ErrorAction SilentlyContinue
  $replaced = $true

  Start-Service -Name 'AbdoErpLocal'
  (Get-Service -Name 'AbdoErpLocal').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4310/api/health' -TimeoutSec 3 } catch { $health = $null }
  } while (-not $health.ok -and (Get-Date) -lt $deadline)
  if (-not $health.ok) { throw 'Restored database did not pass the API health check.' }
  if ([int]$health.data.schemaVersion -ne $currentSchemaVersion) { throw 'Restored database did not migrate to the installed schema.' }

  $activeOutput = & $node $verifier $database
  $activeExitCode = $LASTEXITCODE
  $active = $activeOutput | ConvertFrom-Json
  if ($activeExitCode -ne 0 -or -not $active.ok) { throw 'Restored database failed its final integrity check.' }
  $shell = Invoke-WebRequest -Uri 'http://127.0.0.1:4310/erp' -TimeoutSec 5 -UseBasicParsing
  if ($shell.StatusCode -ne 200) { throw 'ERP shell check failed after restore.' }

  Start-Service -Name 'AbdoErpLocalProxy'
  (Get-Service -Name 'AbdoErpLocalProxy').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  & $node $httpsVerifier 'https://localhost/erp' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'HTTPS check failed after restore.' }
} catch {
  Stop-Service -Name 'AbdoErpLocalProxy' -Force -ErrorAction SilentlyContinue
  Stop-Service -Name 'AbdoErpLocal' -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath "$database-wal", "$database-shm", "$database.restore" -Force -ErrorAction SilentlyContinue
  if ($replaced -and (Test-Path -LiteralPath $recoveryDatabase)) {
    Copy-Item -LiteralPath $recoveryDatabase -Destination $database -Force
    foreach ($suffix in @('-wal', '-shm')) {
      if (Test-Path -LiteralPath "$recoveryDatabase$suffix") {
        Copy-Item -LiteralPath "$recoveryDatabase$suffix" -Destination "$database$suffix" -Force
      }
    }
  }
  Start-Service -Name 'AbdoErpLocal' -ErrorAction SilentlyContinue
  Start-Service -Name 'AbdoErpLocalProxy' -ErrorAction SilentlyContinue
  throw
}

[pscustomobject]@{
  status = 'ok'
  restoredFrom = $backup
  recoveryCopy = $recoveryDatabase
  manifestVerified = $verified.manifestVerified
  sha256 = $verified.sha256
  backupSchemaVersion = $verified.schemaVersion
  activeSchemaVersion = $health.data.schemaVersion
  health = $health.data.status
  httpsVerified = $true
} | ConvertTo-Json
