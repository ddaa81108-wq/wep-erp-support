# Fully isolated wrapper tests: fake programs, fake health and no Windows services.
$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'deploy-and-verify-admin.ps1'))
$start = $source.IndexOf('$identity =')
$end = $source.IndexOf('$SourceRoot = [IO.Path]')
if ($start -lt 0 -or $end -lt $start) { throw 'Deployment wrapper layout changed; update this test.' }
$source = $source.Substring(0, $start) + $source.Substring($end)
$source = $source.Replace("(Join-Path `$PSScriptRoot 'deploy-built-admin.ps1')", "(Join-Path `$SourceRoot 'scripts\fake-deploy.ps1')")
$source = $source.Replace("(Join-Path `$PSScriptRoot 'verify-installed-app.ps1')", "(Join-Path `$SourceRoot 'scripts\fake-verify.ps1')")
$run = [scriptblock]::Create($source)
$root = Join-Path ([IO.Path]::GetTempPath()) ('erp-preflight-test-' + [guid]::NewGuid().ToString('N'))
function Invoke-RestMethod {
  param($Uri, $TimeoutSec)
  $commit = if ($script:scenario -eq 'wrong-commit') { 'old-commit' } else { 'test-commit' }
  return @{ data = @{ status = 'ready'; build = @{ commit = $commit; dirty = $false } } }
}
try {
  New-Item -ItemType Directory -Path (Join-Path $root 'scripts') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $root 'var\release-verification') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $root 'scripts\fake-deploy.ps1'), 'param($SourceRoot) [IO.File]::WriteAllText((Join-Path $SourceRoot "deploy-called"), "test")')
  [IO.File]::WriteAllText((Join-Path $root 'scripts\fake-verify.ps1'), 'param($ReportCopyPath)')
  [IO.File]::WriteAllText((Join-Path $root 'var\release-verification\latest.json'), '{"source":{"commit":"test-commit"}}')
  foreach ($script:scenario in @('denied', 'accepted', 'wrong-commit')) {
    $marker = Join-Path $root 'deploy-called'
    if (Test-Path -LiteralPath $marker) { Remove-Item -LiteralPath $marker }
    $exitCode = if ($script:scenario -eq 'denied') { 7 } else { 0 }
    [IO.File]::WriteAllText((Join-Path $root 'scripts\assert-release.mjs'), "process.exit($exitCode);")
    $failure = $null
    try { & $run -SourceRoot $root | Out-Null } catch { $failure = $_ }
    if ($script:scenario -eq 'denied') {
      if (-not $failure -or (Test-Path -LiteralPath $marker)) { throw 'Preflight rejection did not prevent deployment.' }
    } elseif ($script:scenario -eq 'accepted') {
      if ($failure -or -not (Test-Path -LiteralPath $marker)) { throw "Verified deployment did not proceed: $failure" }
    } elseif (-not $failure) { throw 'Wrong running commit was accepted.' }
    Write-Host "PASS release preflight $script:scenario"
  }
} finally {
  $resolved = [IO.Path]::GetFullPath($root)
  $prefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'erp-preflight-test-*') { throw 'Unsafe fixture cleanup.' }
  if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
