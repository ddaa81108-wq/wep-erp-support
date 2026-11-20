param(
  [string]$InstallRoot = 'C:\Program Files\Abdo ERP Local',
  [ValidateRange(1, 20)][int]$Keep = 3,
  [string]$DeploymentReport = 'C:\ProgramData\AbdoErpLocal\logs\last-deployment.json',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')) { throw 'An installation folder is required.' }
if ((Get-Item -LiteralPath $root -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Installation cannot be a link.' }
$prefix = $root + '\'
$archive = Join-Path $root '.program-archive'
if (Test-Path -LiteralPath $archive) {
  if ((Get-Item -LiteralPath $archive -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Archive cannot be a link.' }
}
$protected = @()
if (Test-Path -LiteralPath $DeploymentReport) {
  # A malformed report must never cause the recovery release to be discarded.
  $report = Get-Content -LiteralPath $DeploymentReport -Raw | ConvertFrom-Json
  if ($report.previousProgramRelease) { $protected += [IO.Path]::GetFullPath($report.previousProgramRelease).TrimEnd('\') }
}
$releases = @(Get-ChildItem -LiteralPath $root -Directory -Force |
  Where-Object { $_.Name -match '^\.deploy-rollback-[a-f0-9]{32}$' } |
  Sort-Object LastWriteTime -Descending)
$protected += @($releases | Select-Object -First $Keep | ForEach-Object FullName)
$archived = @(); $skipped = @()
Add-Type -AssemblyName System.IO.Compression.FileSystem
foreach ($release in $releases) {
  $source = [IO.Path]::GetFullPath($release.FullName).TrimEnd('\')
  if ($protected -contains $source) { continue }
  if (-not $source.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetDirectoryName($source) -ne $root) { throw 'Release escaped installation folder.' }
  if (($release.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      @(Get-ChildItem -LiteralPath $source -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
    $skipped += $release.Name; continue
  }
  $unexpected = @(Get-ChildItem -LiteralPath $source -Force | Where-Object { $_.Name -notin @('server','web','tools') })
  if ($unexpected.Count -or -not (Test-Path -LiteralPath (Join-Path $source 'server\main.mjs')) -or
      -not (Test-Path -LiteralPath (Join-Path $source 'web\index.html'))) {
    $skipped += $release.Name; continue
  }
  $zipPath = [IO.Path]::GetFullPath((Join-Path $archive ($release.Name + '.zip')))
  if (-not $zipPath.StartsWith($archive + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive escaped destination.' }
  if (Test-Path -LiteralPath $zipPath) { $skipped += $release.Name; continue }
  if (-not $Apply) { $archived += $release.Name; continue }
  New-Item -ItemType Directory -Path $archive -Force | Out-Null
  $temporary = $zipPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    $files = @(Get-ChildItem -LiteralPath $source -File -Recurse -Force)
    $manifest = @{}
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($source.Length + 1).Replace('\','/')
      $manifest[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    [IO.Compression.ZipFile]::CreateFromDirectory($source, $temporary, [IO.Compression.CompressionLevel]::Optimal, $false)
    $zip = [IO.Compression.ZipFile]::OpenRead($temporary)
    try {
      $entries = @($zip.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
      if ($entries.Count -ne $manifest.Count) { throw 'Archive file count differs.' }
      foreach ($entry in $entries) {
        $stream = $entry.Open(); $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') }
        finally { $stream.Dispose(); $sha.Dispose() }
        if ($manifest[$entry.FullName] -ne $hash) { throw 'Archive content differs.' }
      }
    } finally { $zip.Dispose() }
    # Recheck source before removing it; the verified ZIP remains recoverable.
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($source.Length + 1).Replace('\','/')
      if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $manifest[$relative]) { throw 'Source changed during archiving.' }
    }
    if (@(Get-ChildItem -LiteralPath $source -File -Recurse -Force).Count -ne $manifest.Count) { throw 'Source file list changed.' }
    Move-Item -LiteralPath $temporary -Destination $zipPath
    # Both absolute paths were checked against the named installation/archive;
    # only a validated old program release is removed, never dist or live data.
    if (-not ([IO.Path]::GetFullPath($source).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase))) { throw 'Invalid removal path.' }
    Remove-Item -LiteralPath $source -Recurse -Force
    $archived += $release.Name
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}
[pscustomobject]@{mode=$(if($Apply){'applied'}else{'preview'}); retained=$releases.Count-$archived.Count; archived=$archived.Count; skipped=$skipped; archive=$archive} | ConvertTo-Json -Compress
