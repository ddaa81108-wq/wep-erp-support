param([string]$BackupPath, [string]$KeyFile, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
if (-not $BackupPath) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'اختر النسخة الاحتياطية للعرض فقط'
    $dialog.Filter = 'Abdo ERP backup (*.abdobackup;*.sqlite;*.json)|*.abdobackup;*.sqlite;*.json'
    $backupFolder = Join-Path $env:ProgramData 'AbdoErpLocal\backups'
    if (Test-Path -LiteralPath $backupFolder) { $dialog.InitialDirectory = $backupFolder }
    if ($dialog.ShowDialog() -ne 'OK') { return }
    $BackupPath = $dialog.FileName
    $dialog.Dispose()
}
$BackupPath = (Resolve-Path -LiteralPath $BackupPath).Path
$node = Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $node) {
    $node = 'C:\Program Files\Abdo ERP Local\vendor\runtime\node-v24.16.0-win-x64\node.exe'
    if (-not (Test-Path -LiteralPath $node)) { throw 'يلزم Node.js 24 أو أحدث لتشغيل العارض.' }
}
$major = (& $node --version) -replace '^v(\d+).*$', '$1'
if ([int]$major -lt 24) { throw 'يلزم Node.js 24 أو أحدث.' }
$config = @{ backupPath=$BackupPath; openBrowser=(-not $NoBrowser) }
$stream = [IO.File]::OpenRead($BackupPath)
try { $first = $stream.ReadByte() } finally { $stream.Dispose() }
if ($first -ne 83) {
    $data = Get-Content -LiteralPath $BackupPath -Raw | ConvertFrom-Json
    if ($data.format -eq 'abdo-erp-encrypted-backup') {
        $automaticKey = Join-Path $env:ProgramData 'AbdoErpLocal\secrets\backup-encryption.key'
        $scheduledFolder = [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'AbdoErpLocal\backups'))
        if (-not $KeyFile -and [IO.Path]::GetDirectoryName($BackupPath) -eq $scheduledFolder -and (Test-Path -LiteralPath $automaticKey)) { $KeyFile=$automaticKey }
        if ($KeyFile) { $config.keyFile=(Resolve-Path -LiteralPath $KeyFile).Path }
        else {
            $securePassword = Read-Host 'كلمة فك تشفير النسخة (لن تظهر)' -AsSecureString
            $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
            try { $config.password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $securePassword.Dispose() }
        }
    }
}
# Pass the password through stdin, never process arguments or a saved config file.
$previousEncoding = $OutputEncoding
try {
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $config | ConvertTo-Json -Compress | & $node (Join-Path $PSScriptRoot 'viewer.mjs')
    if ($LASTEXITCODE) { throw 'لم تكتمل معاينة النسخة.' }
} finally { $config.password=$null; $OutputEncoding=$previousEncoding }
