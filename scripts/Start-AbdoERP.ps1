param([switch]$StartServices)

$ErrorActionPreference = 'Stop'
$serviceNames = @('AbdoErpLocal', 'AbdoErpLocalProxy')
$url = 'https://localhost/erp'

try {
  foreach ($name in $serviceNames) {
    if (-not (Get-Service -Name $name -ErrorAction SilentlyContinue)) {
      throw "The Windows service $name is missing. Install the ERP package first."
    }
  }

  $stopped = @($serviceNames | Where-Object { (Get-Service -Name $_).Status -ne 'Running' })
  if ($stopped.Count -gt 0) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      if ($StartServices) { throw 'Administrator privileges are required to start the services.' }
      $quotedScript = '"' + $PSCommandPath + '"'
      $args = "-NoProfile -ExecutionPolicy Bypass -File $quotedScript -StartServices"
      $child = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $args -Verb RunAs -WindowStyle Hidden -Wait -PassThru
      if ($child.ExitCode -ne 0) { throw 'The ERP services could not be started.' }
    } else {
      foreach ($name in $serviceNames) {
        if ((Get-Service -Name $name).Status -ne 'Running') {
          Start-Service -Name $name
          (Get-Service -Name $name).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
        }
      }
    }
  }

  $deadline = (Get-Date).AddSeconds(45)
  do {
    try {
      $health = Invoke-RestMethod -Uri 'https://localhost/api/health' -TimeoutSec 5
    } catch {
      $health = $null
      Start-Sleep -Seconds 2
    }
  } while (-not $health.ok -and (Get-Date) -lt $deadline)
  if (-not $health.ok) { throw 'HTTPS health check failed. Inspect the Windows service logs.' }

  if (-not $StartServices) { Start-Process -FilePath $url }
} catch {
  Write-Error $_
  exit 1
}
