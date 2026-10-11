param([string]$Domain = 'vip2100.com')
$ErrorActionPreference = 'Stop'
$services = 'C:\ProgramData\AbdoErpLocal\services'
$addresses = @(Resolve-DnsName $Domain -Type A -ErrorAction Stop | Where-Object IPAddress | Select-Object -ExpandProperty IPAddress)
$publicIp = [string](Invoke-RestMethod https://api.ipify.org)
if ($addresses -notcontains $publicIp.Trim()) { throw "DNS must point to the server public IP ($publicIp)." }
Copy-Item "$services\Caddyfile" "$services\Caddyfile.before-domain" -Force
Copy-Item "$services\Caddyfile.domain" "$services\Caddyfile" -Force
Enable-NetFirewallRule -DisplayName 'Abdo ERP Domain HTTP HTTPS'
try {
  Restart-Service AbdoErpLocalProxy
  Start-Sleep -Seconds 8
  $health = Invoke-RestMethod "https://$Domain/api/health" -TimeoutSec 20
  if (-not $health.ok) { throw 'Domain health check failed' }
  $health | ConvertTo-Json
} catch {
  Disable-NetFirewallRule -DisplayName 'Abdo ERP Domain HTTP HTTPS'
  Copy-Item "$services\Caddyfile.before-domain" "$services\Caddyfile" -Force
  Restart-Service AbdoErpLocalProxy
  throw
}
