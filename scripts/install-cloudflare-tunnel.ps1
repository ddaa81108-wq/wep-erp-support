param([string]$TokenPath = 'C:\ProgramData\AbdoErpLocal\secrets\cloudflare-tunnel.token')
$ErrorActionPreference = 'Stop'
$install='C:\Program Files\Abdo ERP Local'
$data='C:\ProgramData\AbdoErpLocal'
$name='AbdoErpTunnel'
$services="$data\services"
$exe="$install\vendor\runtime\cloudflared.exe"
if (-not (Test-Path $exe)) { throw 'cloudflared runtime missing' }
if (-not (Test-Path $TokenPath)) { throw 'Tunnel token file missing' }
if ((Get-Service $name -ErrorAction SilentlyContinue)) { throw 'Tunnel service already exists' }
Copy-Item "$install\vendor\runtime\winsw-ready.exe" "$services\$name.exe"
$xml=@"
<service>
  <id>$name</id><name>Abdo ERP Cloudflare Tunnel</name>
  <description>Encrypted outbound tunnel for vip2100.com</description>
  <executable>$exe</executable>
  <arguments>tunnel --protocol http2 --metrics 127.0.0.1:49312 run --token-file &quot;$TokenPath&quot;</arguments>
  <workingdirectory>$install</workingdirectory>
  <depend>AbdoErpLocal</depend><startmode>Automatic</startmode>
  <onfailure action="restart" delay="10 sec"/><stoptimeout>20 sec</stoptimeout>
  <logpath>$data\logs</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
"@
[IO.File]::WriteAllText("$services\$name.xml",$xml)
& "$services\$name.exe" install
if($LASTEXITCODE){throw 'Tunnel service installation failed'}
& sc.exe config $name obj= "NT SERVICE\$name"
if($LASTEXITCODE){throw 'Tunnel service identity failed'}
foreach($dir in @($data,$services,"$data\secrets")) {
  & icacls.exe $dir /grant "NT SERVICE\$name`:RX" | Out-Null
  if($LASTEXITCODE){throw 'Tunnel directory ACL failed'}
}
& icacls.exe $TokenPath /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' "NT SERVICE\$name`:R" | Out-Null
if($LASTEXITCODE){throw 'Token ACL failed'}
& icacls.exe "$data\logs" /grant "NT SERVICE\$name`:(OI)(CI)M" | Out-Null
if($LASTEXITCODE){throw 'Tunnel logs ACL failed'}
foreach($file in @("$services\$name.exe","$services\$name.xml")) {
  & icacls.exe $file /grant "NT SERVICE\$name`:RX" | Out-Null
  if($LASTEXITCODE){throw 'Tunnel service file ACL failed'}
}
Start-Service $name
Get-Service $name | Select-Object Name,Status,StartType
