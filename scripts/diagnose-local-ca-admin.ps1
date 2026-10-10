$ErrorActionPreference = 'Stop'

$leafPath = 'C:\ProgramData\AbdoErpLocal\tls\abdo-erp-local.pem'
$rootPath = 'C:\ProgramData\AbdoErpLocal\tls\ca\rootCA.pem'
$reportPath = 'C:\ProgramData\AbdoErpLocal\logs\local-ca-diagnostic.json'

function Read-PemCertificate([string]$Path) {
  $base64 = ((Get-Content -LiteralPath $Path) | Where-Object { $_ -notmatch '^-----' }) -join ''
  $bytes = [Convert]::FromBase64String($base64)
  return [Security.Cryptography.X509Certificates.X509Certificate2]::new($bytes)
}

$leaf = Read-PemCertificate $leafPath
$root = Read-PemCertificate $rootPath
$machineRoot = Get-ChildItem Cert:\LocalMachine\Root | Where-Object Thumbprint -eq $root.Thumbprint | Select-Object -First 1
$chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
$chain.ChainPolicy.RevocationMode = 'NoCheck'
$chainOk = $chain.Build($leaf)
$statuses = @($chain.ChainStatus | ForEach-Object { $_.Status.ToString() + ': ' + $_.StatusInformation.Trim() })

[ordered]@{
  leafSubject = $leaf.Subject
  leafIssuer = $leaf.Issuer
  leafThumbprint = $leaf.Thumbprint
  leafNotBefore = $leaf.NotBefore.ToString('o')
  leafNotAfter = $leaf.NotAfter.ToString('o')
  rootSubject = $root.Subject
  rootThumbprint = $root.Thumbprint
  machineRootTrusted = [bool]$machineRoot
  chainOk = $chainOk
  chainStatus = $statuses
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $reportPath -Encoding utf8

$chain.Dispose()
$leaf.Dispose()
$root.Dispose()
