$ErrorActionPreference = 'Stop'

$rootCertificate = 'C:\ProgramData\AbdoErpLocal\tls\ca\rootCA.pem'
$logPath = 'C:\ProgramData\AbdoErpLocal\logs\repair-local-ca.log'

try {
  if (-not (Test-Path -LiteralPath $rootCertificate)) {
    throw "Local CA certificate is missing: $rootCertificate"
  }
  & certutil.exe -addstore -f Root $rootCertificate | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "certutil failed with exit code $LASTEXITCODE"
  }
  Restart-Service -Name 'AbdoErpLocalProxy' -Force
  (Get-Service -Name 'AbdoErpLocalProxy').WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  'Local CA trust repaired successfully.' | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 0
} catch {
  ('Local CA trust repair failed: ' + $_.Exception.Message) | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 1
}
