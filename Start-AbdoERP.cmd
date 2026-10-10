@echo off
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-AbdoERP.ps1"
if errorlevel 1 (
  echo Abdo ERP did not start. Review the service status and logs.
  pause
)
