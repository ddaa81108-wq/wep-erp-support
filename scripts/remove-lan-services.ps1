param(
  [string]$InstallRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$DataRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'var')
)

$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$DataRoot = [IO.Path]::GetFullPath($DataRoot)
$serviceRoot = Join-Path ([IO.Path]::GetFullPath($DataRoot)) 'services'

foreach ($service in @(
  @{ Name = 'AbdoErpLocalProxy'; Wrapper = (Join-Path $serviceRoot 'AbdoErpLocalProxy.exe') },
  @{ Name = 'AbdoErpLocal'; Wrapper = (Join-Path $serviceRoot 'AbdoErpLocal.exe') }
)) {
  if (Get-Service -Name $service.Name -ErrorAction SilentlyContinue) {
    if (Test-Path -LiteralPath $service.Wrapper) {
      & $service.Wrapper stop | Out-Host
      & $service.Wrapper uninstall | Out-Host
    } else {
      Stop-Service -Name $service.Name -Force -ErrorAction SilentlyContinue
      sc.exe delete $service.Name | Out-Host
    }
  }
}

Get-NetFirewallRule -DisplayName 'Abdo ERP Local HTTPS (Private LAN)' -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule

$thumbprintFile = Join-Path $DataRoot 'tls\rootCA.thumbprint'
if (Test-Path -LiteralPath $thumbprintFile) {
  $thumbprint = (Get-Content -LiteralPath $thumbprintFile -Raw).Trim()
  if ($thumbprint -match '^[A-Fa-f0-9]{40}$') {
    & certutil.exe -delstore Root $thumbprint | Out-Host
  }
}

Write-Host 'Services, the private-LAN firewall rule, and CA trust were removed. Database files were preserved.'
