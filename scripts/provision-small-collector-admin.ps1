param([Parameter(Mandatory=$true)][string]$TemporaryPassword,[Parameter(Mandatory=$true)][string]$ResultPath)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$script=Join-Path $PSScriptRoot 'provision-small-collector.mjs'
$output=& node $script 'C:\ProgramData\AbdoErpLocal\data\abdo-erp.sqlite' $TemporaryPassword
Set-Content -LiteralPath $ResultPath -Value $output -Encoding utf8
