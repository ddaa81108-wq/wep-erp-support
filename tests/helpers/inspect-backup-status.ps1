param([string]$Root)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../scripts/backup-status.ps1')
$results = @{}
foreach ($name in @('missing','empty','legacy','encrypted','no-manifest','invalid-json','wrong-file','wrong-size','expired','future','new-incomplete')) {
  $results[$name] = Get-BackupStatus (Join-Path $Root $name) 26
}
$results | ConvertTo-Json -Depth 4 -Compress
