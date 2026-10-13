param(
  [string]$ServiceXml = 'C:\ProgramData\AbdoErpLocal\services\AbdoErpLocal.xml',
  [string]$DatabasePath = 'C:\ProgramData\AbdoErpLocal\data\abdo-erp.sqlite',
  [string]$BackupDirectory = 'C:\ProgramData\AbdoErpLocal\backups',
  [string]$ExternalBackupDirectory = ''
)
# Read-only inventory. Never print service arguments, environment values or keys.
$ErrorActionPreference = 'Stop'
$secureCookie = 'unknown'
$databaseMatches = 'unknown'
if (Test-Path -LiteralPath $ServiceXml -PathType Leaf) {
  $doc = New-Object System.Xml.XmlDocument
  $doc.XmlResolver = $null
  $doc.Load($ServiceXml)
  $cookie = $doc.SelectSingleNode('/*[local-name()="service"]/*[local-name()="env"][@name="ABDO_COOKIE_SECURE"]')
  if ($cookie) { $secureCookie = $cookie.GetAttribute('value') -eq 'true' }
  $db = $doc.SelectSingleNode('/*[local-name()="service"]/*[local-name()="env"][@name="ABDO_DB_PATH"]')
  if ($db) { $databaseMatches = [IO.Path]::GetFullPath($db.GetAttribute('value')) -eq [IO.Path]::GetFullPath($DatabasePath) }
}
function Get-BackupInventory([string]$Path) {
  if (-not $Path) { return [pscustomobject]@{ State='not-specified' } }
  try {
    $files = @(Get-ChildItem -LiteralPath $Path -File -Filter '*.sqlite' | Sort-Object LastWriteTimeUtc -Descending)
    $latest = $files | Select-Object -First 1
    [pscustomobject]@{
      State='readable'; Count=$files.Count
      LatestUtc=$(if ($latest) { $latest.LastWriteTimeUtc.ToString('o') } else { $null })
      LatestHasManifest=$(if ($latest) { Test-Path -LiteralPath ($latest.FullName + '.json') } else { $false })
      VolumeRoot=[IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Path))
    }
  } catch { [pscustomobject]@{ State='unavailable' } }
}
$acl = @()
if (Test-Path -LiteralPath $DatabasePath) {
  $acl = @((Get-Acl -LiteralPath $DatabasePath).Access | ForEach-Object {
    [pscustomobject]@{ Identity=$_.IdentityReference.Value; Rights=$_.FileSystemRights.ToString(); Type=$_.AccessControlType.ToString(); Inherited=$_.IsInherited }
  })
}
$encryption = 'unknown'
if (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue) {
  try { $encryption = (Get-BitLockerVolume -MountPoint ([IO.Path]::GetPathRoot($DatabasePath))).ProtectionStatus.ToString() } catch { $encryption = 'unavailable' }
}
[pscustomobject]@{
  CheckedAtUtc=[DateTime]::UtcNow.ToString('o')
  Services=@(Get-Service -Name 'AbdoErpLocal','AbdoErpLocalProxy' -ErrorAction SilentlyContinue | Select-Object Name,Status)
  SecureCookie=$secureCookie; ConfiguredDatabaseMatches=$databaseMatches
  DatabaseExists=(Test-Path -LiteralPath $DatabasePath -PathType Leaf)
  DatabaseAcl=$acl; BitLockerProtection=$encryption
  LocalBackups=(Get-BackupInventory $BackupDirectory)
  ExternalBackups=(Get-BackupInventory $ExternalBackupDirectory)
  Note='Read-only inventory; file presence is not a restore test. A different volume is not proof of an independent device. Tunnel and offsite protection require separate verification.'
} | ConvertTo-Json -Depth 6
