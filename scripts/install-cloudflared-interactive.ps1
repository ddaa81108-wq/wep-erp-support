$ErrorActionPreference = 'Stop'
$exe = 'C:\Program Files\Abdo ERP Local\vendor\runtime\cloudflared.exe'
Write-Host 'Paste the Cloudflare installation command or tunnel token, then press Enter.'
$inputText = Read-Host
if ($inputText -notmatch '(eyJ[A-Za-z0-9_+/=-]{60,})') {
    Write-Host 'No valid tunnel token supplied. Nothing was installed.'
    Read-Host 'Press Enter to close'
    exit 1
}
$token = $Matches[1]
$inputText = $null
try {
    if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
        Stop-Service cloudflared -ErrorAction SilentlyContinue
        $tokenFile = 'C:\ProgramData\AbdoErpLocal\secrets\cloudflare-tunnel.token'
        [IO.File]::WriteAllText($tokenFile, $token, [Text.UTF8Encoding]::new($false))
        & icacls.exe $tokenFile /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null
        if ($LASTEXITCODE) { throw 'Token protection failed.' }
        $serviceCommand = '"' + $exe + '" tunnel --protocol http2 run --token-file "' + $tokenFile + '"'
        & sc.exe config cloudflared binPath= $serviceCommand
        if ($LASTEXITCODE) { throw 'Cloudflare service configuration failed.' }
    } else {
        & $exe service install $token
        if ($LASTEXITCODE) { throw 'Cloudflare service installation failed.' }
    }
    $token = $null
    & sc.exe config cloudflared start= auto
    & sc.exe failure cloudflared reset= 86400 actions= restart/10000/restart/30000/restart/60000
    Start-Service cloudflared
    Get-Service cloudflared | Select-Object Name, Status, StartType
} catch {
    Write-Host $_.Exception.Message
}
Read-Host 'Press Enter to close'
