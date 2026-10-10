$ErrorActionPreference = 'Stop'

foreach ($name in @('AbdoErpLocalProxy', 'AbdoErpLocal')) {
  $service = Get-Service -Name $name -ErrorAction SilentlyContinue
  if (-not $service) { continue }
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $name -Force
  }
}

$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
  $running = @(
    Get-Service -Name 'AbdoErpLocalProxy', 'AbdoErpLocal' -ErrorAction SilentlyContinue |
      Where-Object { $_.Status -ne 'Stopped' }
  )
  if ($running.Count -eq 0) { break }
  Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)

if ($running.Count -gt 0) {
  throw "Services did not stop before the update: $($running.Name -join ', ')"
}
