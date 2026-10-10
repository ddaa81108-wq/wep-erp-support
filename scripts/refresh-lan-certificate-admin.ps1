$ErrorActionPreference = 'Stop'

$dataRoot = 'C:\ProgramData\AbdoErpLocal'
$installRoot = 'C:\Program Files\Abdo ERP Local'
$tlsRoot = Join-Path $dataRoot 'tls'
$caRoot = Join-Path $tlsRoot 'ca'
$mkcert = Join-Path $installRoot 'vendor\runtime\mkcert.exe'
$certificate = Join-Path $tlsRoot 'abdo-erp-local.pem'
$privateKey = Join-Path $tlsRoot 'abdo-erp-local-key.pem'
$tempCertificate = Join-Path $tlsRoot 'abdo-erp-local.new.pem'
$tempPrivateKey = Join-Path $tlsRoot 'abdo-erp-local-key.new.pem'
$backupCertificate = Join-Path $tlsRoot 'abdo-erp-local.backup.pem'
$backupPrivateKey = Join-Path $tlsRoot 'abdo-erp-local-key.backup.pem'
$logPath = Join-Path $dataRoot 'logs\refresh-lan-certificate.log'
$configPath = Join-Path $dataRoot 'lan-config.json'
$replaced = $false

try {
  $network = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    Select-Object -First 1
  if (-not $network) { throw 'No active IPv4 LAN connection was found.' }
  $lanIp = [string]$network.IPv4Address.IPAddress
  $machineName = [Environment]::MachineName

  $env:CAROOT = $caRoot
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $mkcert -cert-file $tempCertificate -key-file $tempPrivateKey localhost 127.0.0.1 ::1 $machineName $lanIp 2>&1 | Out-Null
  $mkcertExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($mkcertExitCode -ne 0) { throw "mkcert failed with exit code $mkcertExitCode" }

  & certutil.exe -addstore -f Root (Join-Path $caRoot 'rootCA.pem') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "certutil failed with exit code $LASTEXITCODE" }

  Copy-Item -LiteralPath $certificate -Destination $backupCertificate -Force
  Copy-Item -LiteralPath $privateKey -Destination $backupPrivateKey -Force
  Stop-Service -Name 'AbdoErpLocalProxy' -Force
  Move-Item -LiteralPath $tempCertificate -Destination $certificate -Force
  Move-Item -LiteralPath $tempPrivateKey -Destination $privateKey -Force
  $replaced = $true
  Start-Service -Name 'AbdoErpLocalProxy'
  (Get-Service -Name 'AbdoErpLocalProxy').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))

  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 500
    try { $health = Invoke-RestMethod -Uri 'https://localhost/api/health' -TimeoutSec 3 } catch { $health = $null }
  } while (-not $health.ok -and (Get-Date) -lt $deadline)
  if (-not $health.ok) { throw 'HTTPS health check failed after certificate refresh.' }

  $config = if (Test-Path -LiteralPath $configPath) {
    Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  } else { [pscustomobject]@{} }
  $config | Add-Member -NotePropertyName machineName -NotePropertyValue $machineName -Force
  $config | Add-Member -NotePropertyName lanIp -NotePropertyValue $lanIp -Force
  $config | Add-Member -NotePropertyName url -NotePropertyValue "https://$machineName" -Force
  $config | Add-Member -NotePropertyName healthUrl -NotePropertyValue "https://$machineName/api/health" -Force
  $config | Add-Member -NotePropertyName currentIpUrl -NotePropertyValue "https://$lanIp" -Force
  $config | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding utf8
  Remove-Item -LiteralPath $backupCertificate, $backupPrivateKey -Force

  [ordered]@{ status = 'ok'; lanIp = $lanIp; stableUrl = "https://$machineName"; health = $health.data.status } |
    ConvertTo-Json | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 0
} catch {
  if ($replaced -and (Test-Path -LiteralPath $backupCertificate) -and (Test-Path -LiteralPath $backupPrivateKey)) {
    Stop-Service -Name 'AbdoErpLocalProxy' -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $backupCertificate -Destination $certificate -Force
    Move-Item -LiteralPath $backupPrivateKey -Destination $privateKey -Force
    Start-Service -Name 'AbdoErpLocalProxy' -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $tempCertificate, $tempPrivateKey -Force -ErrorAction SilentlyContinue
  [ordered]@{ status = 'error'; message = $_.Exception.Message } |
    ConvertTo-Json | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 1
}
