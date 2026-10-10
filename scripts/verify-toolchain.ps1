$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot 'vendor\runtime'

$expectedHashes = @{
  'node-v24.16.0-win-x64\node.exe' = 'B3094D0B49F9AD602262A9921551737BB97637C05DD357A06AE98188D7290AA3'
  'caddy.exe' = '5CB9AB71E5756CE72840B8234177A2F40C8B4AB47A806B8E841E2B784E9DF62B'
  'winsw.exe' = '91BCE26B4FA3A7534E7967C1804D7417737B7169014435E5B3B31924BF19F3EE'
  'sqlite3.exe' = '5DA2398D4913B893BD1EA578D85403B3A83A06FABF9D2303CA9F63EF0849FC6F'
  'mkcert.exe' = 'D2660B50A9ED59EADA480750561C96ABC2ED4C9A38C6A24D93E30E0977631398'
}

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '')
    } finally {
      $algorithm.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

foreach ($relativePath in $expectedHashes.Keys) {
  $path = Join-Path $runtimeRoot $relativePath
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Missing runtime file: $relativePath"
  }
  $actual = Get-Sha256 $path
  if ($actual -ne $expectedHashes[$relativePath]) {
    throw "SHA-256 mismatch: $relativePath"
  }
  Write-Host "OK runtime $relativePath"
}

Push-Location $projectRoot
try {
  npm ls --depth=0 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'npm dependency verification failed' }

  node -e 'import("@playwright/test").then(async ({chromium})=>{const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});await page.setContent("<html dir=rtl><body>اختبار محلي</body></html>");if((await page.textContent("body"))!=="اختبار محلي")process.exitCode=1;await browser.close();})'
  if ($LASTEXITCODE -ne 0) { throw 'Playwright Chromium verification failed' }
  Write-Host 'OK Playwright Chromium'
} finally {
  Pop-Location
}
