$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator privileges are required.' }
$securityRoot = 'C:\ProgramData\AbdoErpLocal\secrets'
New-Item -ItemType Directory -Path $securityRoot -Force | Out-Null
foreach ($name in @('account-security.key', 'backup-encryption.key')) {
    $path = Join-Path $securityRoot $name
    if (-not (Test-Path -LiteralPath $path)) {
        $bytes = New-Object byte[] 32
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $hex = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        [IO.File]::WriteAllText($path, $hex, [Text.UTF8Encoding]::new($false))
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
    $stored = [IO.File]::ReadAllText($path).Trim()
    if (($name -eq 'account-security.key' -and $stored -notmatch '^[a-fA-F0-9]{64}$') -or
        ($name -eq 'backup-encryption.key' -and ($stored.Length -lt 12 -or $stored.Length -gt 256))) {
        throw "Existing key format is invalid: $name. The key was not replaced."
    }
    $grants = @('SYSTEM:F', 'Administrators:F')
    $grants += 'NT SERVICE\AbdoErpLocal:R'
    & icacls.exe $path /inheritance:r /grant:r $grants | Out-Null
    if ($LASTEXITCODE) { throw "Failed to restrict access to $name" }
}
$servicePath = 'C:\ProgramData\AbdoErpLocal\services\AbdoErpLocal.xml'
[xml]$config = Get-Content -LiteralPath $servicePath -Raw
foreach ($setting in @(@('ABDO_SECURITY_KEY_FILE', 'account-security.key'), @('ABDO_BACKUP_KEY_FILE', 'backup-encryption.key'))) {
    $entry = @($config.service.env) | Where-Object name -eq $setting[0]
    if (-not $entry) {
        $entry = $config.CreateElement('env')
        $entry.SetAttribute('name', $setting[0])
        [void]$config.service.AppendChild($entry)
    }
    $entry.SetAttribute('value', (Join-Path $securityRoot $setting[1]))
}
$config.Save($servicePath)
Write-Output 'Security keys initialized. Back up both key files separately and securely. Restart the application after deployment.'
