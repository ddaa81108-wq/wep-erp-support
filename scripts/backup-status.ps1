# Read-only metadata inspection. Never decrypt, restore, delete, or modify backups.
function Get-BackupStatus([string]$Path, [int]$AgeHours) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    return [pscustomobject]@{ State='missing'; Count=0; LatestUtc=$null; LatestHasManifest=$false; LatestManifestValid=$false; Fresh=$false }
  }
  $files = @(Get-ChildItem -LiteralPath $Path -File -ErrorAction Stop |
    Where-Object { $_.Extension -in @('.sqlite', '.abdobackup') } |
    Sort-Object LastWriteTimeUtc -Descending)
  $latest = $files | Select-Object -First 1
  $hasManifest = $null -ne $latest -and (Test-Path -LiteralPath ($latest.FullName + '.json') -PathType Leaf)
  $valid = $false
  $createdAt = [DateTimeOffset]::MinValue
  if ($hasManifest) {
    try {
      $manifest = Get-Content -LiteralPath ($latest.FullName + '.json') -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
      $valid = $manifest.manifestVersion -eq 1 -and
        $manifest.file -ceq $latest.Name -and
        $manifest.fileSizeBytes -eq $latest.Length -and
        $manifest.integrity -eq 'ok' -and
        $manifest.foreignKeyProblems -eq 0 -and
        $manifest.sha256 -match '^[a-fA-F0-9]{64}$' -and
        [DateTimeOffset]::TryParse([string]$manifest.createdAt, [ref]$createdAt)
    } catch { $valid = $false }
  }
  $now = [DateTimeOffset]::UtcNow
  $fresh = $valid -and $createdAt -le $now.AddMinutes(5) -and
    ($now - $createdAt).TotalHours -le $AgeHours
  [pscustomobject]@{
    State='readable'; Count=$files.Count
    LatestUtc=$(if ($latest) { $latest.LastWriteTimeUtc.ToString('o') } else { $null })
    LatestHasManifest=$hasManifest; LatestManifestValid=$valid; Fresh=$fresh
  }
}
