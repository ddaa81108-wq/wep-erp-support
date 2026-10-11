param([string]$Domain = 'vip2100.com')
$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $PSScriptRoot
$install = 'C:\Program Files\Abdo ERP Local'
$data = 'C:\ProgramData\AbdoErpLocal'
$runtime = Join-Path $install 'vendor\runtime'
$services = Join-Path $data 'services'
$logs = Join-Path $data 'logs'
$db = Join-Path $data 'data\abdo-erp.sqlite'
$node = Join-Path $runtime 'node-v24.16.0-win-x64\node.exe'
if ($Domain -notmatch '^[a-z0-9.-]+$') { throw 'Invalid domain' }
foreach ($file in @('caddy.exe', 'winsw-ready.exe')) {
  if ((Get-Item (Join-Path $runtime $file)).Length -lt 100000) { throw "Missing runtime: $file" }
}
if (Get-Service AbdoErpLocal -ErrorAction SilentlyContinue) { throw 'Service already exists; use an upgrade procedure.' }
New-Item -ItemType Directory -Force -Path $services,$logs,(Split-Path $db),"$data\caddy","$data\backups",(Split-Path $node),"$install\scripts" | Out-Null
Copy-Item 'C:\Program Files\nodejs\node.exe' $node
Copy-Item (Join-Path $source 'dist') $install -Recurse -Force
Copy-Item (Join-Path $source 'scripts\*.mjs') "$install\scripts" -Force
Copy-Item (Join-Path $source 'scripts\*backup*.ps1') "$install\scripts" -Force
Copy-Item (Join-Path $source 'scripts\Start-AbdoERP.ps1') "$install\scripts" -Force
Copy-Item (Join-Path $source 'Start-AbdoERP.cmd') $install -Force
$caddy = Join-Path $runtime 'caddy.exe'
$localConfig = @"
{
  admin off
}
https://localhost {
  bind 127.0.0.1
  tls internal
  encode zstd gzip
  reverse_proxy 127.0.0.1:4310
}
"@
$domainConfig = @"
{
  admin off
}
$Domain {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=15552000"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "no-referrer"
    X-Frame-Options "DENY"
  }
  reverse_proxy 127.0.0.1:4310
  log {
    output file C:/ProgramData/AbdoErpLocal/logs/access.json {
      roll_size 10MiB
      roll_keep 10
    }
  }
}
https://localhost {
  tls internal
  reverse_proxy 127.0.0.1:4310
}
"@
[IO.File]::WriteAllText("$services\Caddyfile", $localConfig)
[IO.File]::WriteAllText("$services\Caddyfile.domain", $domainConfig)
& $caddy validate --config "$services\Caddyfile.domain" --adapter caddyfile
if ($LASTEXITCODE) { throw 'Invalid domain configuration' }
function Escape([string]$value) { [Security.SecurityElement]::Escape($value) }
foreach ($name in @('AbdoErpLocal','AbdoErpLocalProxy')) {
  Copy-Item "$runtime\winsw-ready.exe" "$services\$name.exe"
  $isApi = $name -eq 'AbdoErpLocal'
  $exe = if ($isApi) { $node } else { $caddy }
  $arguments = if ($isApi) { '&quot;' + (Escape "$install\dist\server\main.mjs") + '&quot;' } else { 'run --config &quot;' + (Escape "$services\Caddyfile") + '&quot; --adapter caddyfile' }
  $environment = if ($isApi) { '<env name="ABDO_HOST" value="127.0.0.1"/><env name="ABDO_PORT" value="4310"/><env name="ABDO_COOKIE_SECURE" value="true"/><env name="ABDO_DB_PATH" value="' + (Escape $db) + '"/>' } else { '<env name="XDG_DATA_HOME" value="C:\ProgramData\AbdoErpLocal\caddy"/><env name="XDG_CONFIG_HOME" value="C:\ProgramData\AbdoErpLocal\caddy"/>' }
  $dependency = if ($isApi) { '' } else { '<depend>AbdoErpLocal</depend>' }
  $xml = '<service><id>'+$name+'</id><name>'+$name+'</name><description>Abdo ERP application service</description><executable>'+(Escape $exe)+'</executable><arguments>'+$arguments+'</arguments><workingdirectory>'+(Escape $install)+'</workingdirectory>'+$environment+$dependency+'<startmode>Automatic</startmode><onfailure action="restart" delay="10 sec"/><stoptimeout>20 sec</stoptimeout><logpath>'+(Escape $logs)+'</logpath><log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log></service>'
  [IO.File]::WriteAllText("$services\$name.xml",$xml)
  & "$services\$name.exe" install
  if ($LASTEXITCODE) { throw "Unable to install $name" }
  & sc.exe config $name obj= "NT SERVICE\$name"
  if ($LASTEXITCODE) { throw 'Unable to set service account' }
}
& icacls.exe $data /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'NT SERVICE\AbdoErpLocal:RX' 'NT SERVICE\AbdoErpLocalProxy:RX' | Out-Null
& icacls.exe "$data\data" /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'NT SERVICE\AbdoErpLocal:(OI)(CI)M' | Out-Null
& icacls.exe $logs /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'NT SERVICE\AbdoErpLocal:(OI)(CI)M' 'NT SERVICE\AbdoErpLocalProxy:(OI)(CI)M' | Out-Null
& icacls.exe "$data\caddy" /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'NT SERVICE\AbdoErpLocalProxy:(OI)(CI)M' | Out-Null
& icacls.exe $services /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' 'NT SERVICE\AbdoErpLocal:(OI)(CI)RX' 'NT SERVICE\AbdoErpLocalProxy:(OI)(CI)RX' | Out-Null
& icacls.exe "$data\backups" /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
$listener = Get-NetTCPConnection -State Listen -LocalPort 4310 -ErrorAction Stop
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
if ($process.CommandLine -notmatch 'src/server/main.ts') { throw 'Unexpected existing API process' }
Stop-Process -Id $listener.OwningProcess -Force
# SQLite backup reads committed WAL contents after the old writer has stopped.
& $node "$source\scripts\backup-database.mjs" "$source\var\abdo-erp.sqlite" "$data\backups" 30
if ($LASTEXITCODE) { throw 'Database migration backup failed' }
$latest = Get-ChildItem "$data\backups\*.sqlite" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $latest.FullName $db
Start-Service AbdoErpLocal
Start-Service AbdoErpLocalProxy
& "$install\scripts\configure-backup-task-admin.ps1" -Activate
if ($LASTEXITCODE) { throw 'Backup setup failed' }
New-NetFirewallRule -DisplayName 'Abdo ERP Domain HTTP HTTPS' -Direction Inbound -Action Allow -Profile Any -Program $caddy -Protocol TCP -LocalPort 80,443 -Enabled False | Out-Null
$health = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try { $health = Invoke-RestMethod http://127.0.0.1:4310/api/health -TimeoutSec 3; if ($health.ok) { break } } catch {}
  Start-Sleep -Seconds 1
}
if (-not $health.ok) { throw 'API health check failed after service installation' }
$rootCertificate = "$data\caddy\caddy\pki\authorities\local\root.crt"
for ($attempt = 0; $attempt -lt 20 -and -not (Test-Path $rootCertificate); $attempt++) { Start-Sleep -Seconds 1 }
if (-not (Test-Path $rootCertificate)) { throw 'Local HTTPS root certificate missing' }
Import-Certificate -FilePath $rootCertificate -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Invoke-RestMethod https://localhost/api/health -TimeoutSec 10 | Out-Null
$health | ConvertTo-Json
