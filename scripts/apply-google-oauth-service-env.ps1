$ErrorActionPreference = 'Stop'

$serviceName = 'AbdoErpLocal'
$serviceRoot = 'C:\ProgramData\AbdoErpLocal\services'
$serviceXmlPath = Join-Path $serviceRoot 'AbdoErpLocal.xml'
$secretPath = 'C:\ProgramData\AbdoErpLocal\secrets\google-oauth.json'
$logPath = 'C:\ProgramData\AbdoErpLocal\logs\google-oauth-apply.log'

try {
  if (-not (Test-Path -LiteralPath $serviceXmlPath)) {
    throw "Service configuration is missing: $serviceXmlPath"
  }
  if (-not (Test-Path -LiteralPath $secretPath)) {
    throw "OAuth settings are missing: $secretPath"
  }

  $settings = Get-Content -Raw -LiteralPath $secretPath | ConvertFrom-Json
  if (-not $settings.clientId -or -not $settings.clientSecret) {
    throw 'OAuth settings are incomplete.'
  }
  $redirectUri = if ($settings.redirectUri) {
    [string]$settings.redirectUri
  } else {
    'https://localhost/api/auth/google/callback'
  }

  & icacls.exe $serviceXmlPath /inheritance:r /grant:r `
    'SYSTEM:F' `
    'Administrators:F' `
    "$env:USERNAME`:F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to protect the service configuration (icacls exit $LASTEXITCODE)."
  }

  [xml]$xml = Get-Content -Raw -LiteralPath $serviceXmlPath
  $values = [ordered]@{
    ABDO_GOOGLE_CLIENT_ID = [string]$settings.clientId
    ABDO_GOOGLE_CLIENT_SECRET = [string]$settings.clientSecret
    ABDO_GOOGLE_REDIRECT_URI = $redirectUri
  }

  foreach ($name in $values.Keys) {
    $existing = @($xml.service.env) | Where-Object { $_.name -eq $name } | Select-Object -First 1
    if ($existing) {
      $existing.value = $values[$name]
      continue
    }
    $element = $xml.CreateElement('env')
    $element.SetAttribute('name', $name)
    $element.SetAttribute('value', $values[$name])
    [void]$xml.service.AppendChild($element)
  }

  $xml.Save($serviceXmlPath)
  Restart-Service -Name $serviceName -Force
  (Get-Service -Name $serviceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  'Google OAuth environment applied successfully.' | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 0
} catch {
  ('Google OAuth environment failed: ' + $_.Exception.Message) | Set-Content -LiteralPath $logPath -Encoding utf8
  exit 1
}
