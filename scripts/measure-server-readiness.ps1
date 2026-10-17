param(
  [string]$LocalUrl = 'http://127.0.0.1:4310',
  [string]$PublicUrl = 'https://vip2100.com',
  [ValidateRange(1,10)][int]$Samples = 3
)
# Read-only: no restart, firewall changes, credentials, or database writes.
$ErrorActionPreference = 'Stop'
function Measure-Endpoint([string]$BaseUrl) {
  $uri = [Uri]($BaseUrl.TrimEnd('/') + '/api/health')
  if ($uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query) {
    throw 'Use a plain HTTP/HTTPS server URL without credentials or query parameters.'
  }
  $results = @()
  for ($index = 0; $index -lt $Samples; $index++) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
      $response = Invoke-WebRequest -Uri $uri.AbsoluteUri -UseBasicParsing -TimeoutSec 15
      $watch.Stop()
      $health = $response.Content | ConvertFrom-Json
      $results += [pscustomobject]@{
        Http = [int]$response.StatusCode
        Ready = ($health.ok -eq $true -and $health.data.status -eq 'ready')
        Milliseconds = [Math]::Round($watch.Elapsed.TotalMilliseconds, 1)
        Version = $health.data.uiVersion
        Commit = $health.data.build.commit
        ModifiedBuild = $health.data.build.dirty
        BuiltAt = $health.data.build.builtAt
      }
    } catch {
      $watch.Stop()
      $results += [pscustomobject]@{ Ready=$false; Milliseconds=[Math]::Round($watch.Elapsed.TotalMilliseconds,1); ErrorType=$_.Exception.GetType().Name }
    }
  }
  [pscustomobject]@{ Endpoint=$uri.GetLeftPart([UriPartial]::Authority); Samples=$results }
}
$encryption = 'unknown'
if (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue) {
  try { $encryption = (Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop).ProtectionStatus.ToString() }
  catch { $encryption = 'unavailable' }
}
[pscustomobject]@{
  CheckedAtUtc=[DateTime]::UtcNow.ToString('o')
  Services=@(Get-Service -Name 'AbdoErpLocal','AbdoErpLocalProxy','AbdoErpTunnel' -ErrorAction SilentlyContinue | ForEach-Object {
    [pscustomobject]@{ Name=$_.Name; Status=$_.Status.ToString(); StartType=$_.StartType.ToString() }
  })
  SystemDriveEncryption=$encryption
  Local=(Measure-Endpoint $LocalUrl)
  Public=$(if ($PublicUrl) { Measure-Endpoint $PublicUrl } else { $null })
  Note='Read-only health latency, not ledger/render performance, a restore test, or a security certification. Missing commit means an older/development build.'
} | ConvertTo-Json -Depth 7
