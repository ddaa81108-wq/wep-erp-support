#define MyAppName "Abdo ERP Local"
#define MyAppVersion "0.14.0"
#define MyAppPublisher "Abdo ERP Local"

[Setup]
AppId={{A1DB4608-0E45-47C7-A08C-0AC948C49E75}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Abdo ERP Local
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist\installer
OutputBaseFilename=Abdo-ERP-Local-Setup-0.14.0
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
SetupLogging=yes
CloseApplications=yes
RestartApplications=no
UninstallDisplayName={#MyAppName}
VersionInfoVersion=0.14.0.0
VersionInfoDescription=Abdo ERP Local core
VersionInfoCompany={#MyAppPublisher}
VersionInfoProductName={#MyAppName}

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Dirs]
Name: "{commonappdata}\AbdoErpLocal"

[Files]
Source: "..\..\dist\server\*"; DestDir: "{app}\dist\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\dist\web\*"; DestDir: "{app}\dist\web"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\vendor\runtime\node-v24.16.0-win-x64\node.exe"; DestDir: "{app}\vendor\runtime\node-v24.16.0-win-x64"; Flags: ignoreversion
Source: "..\..\vendor\runtime\node-v24.16.0-win-x64\LICENSE"; DestDir: "{app}\vendor\runtime\node-v24.16.0-win-x64"; Flags: ignoreversion
Source: "..\..\vendor\runtime\caddy.exe"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\winsw.exe"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\mkcert.exe"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\sqlite3.exe"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\LICENSE-CADDY.txt"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\LICENSE-WINSW.txt"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\LICENSE-MKCERT.txt"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\vendor\runtime\README.md"; DestDir: "{app}\vendor\runtime"; Flags: ignoreversion
Source: "..\..\scripts\configure-lan.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\harden-windows-services-admin.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\verify-https.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\verify-lan-install.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\Start-AbdoERP.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\dist\tools\backup-database.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\dist\tools\*"; DestDir: "{app}\dist\tools"; Flags: ignoreversion
Source: "..\..\scripts\initialize-security-admin.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\verify-database.mjs"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\configure-backup-task-admin.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\restore-database-admin.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\Start-AbdoERP.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\scripts\remove-lan-services.ps1"; DestDir: "{app}\scripts"; Flags: ignoreversion
Source: "..\..\scripts\stop-lan-services.ps1"; Flags: dontcopy
Source: "..\..\public\card-studio\*"; DestDir: "{app}\public\card-studio"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\OPERATIONS.ar.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\..\LOCAL_ARCHITECTURE.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\..\API.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\..\FEATURE_PARITY.md"; DestDir: "{app}\docs"; Flags: ignoreversion
Source: "..\..\ACCEPTANCE_REPORT.md"; DestDir: "{app}\docs"; Flags: ignoreversion

[InstallDelete]
Type: files; Name: "{app}\dist\web\sw.js"
Type: files; Name: "{app}\dist\web\manifest.webmanifest"
Type: files; Name: "{app}\dist\web\app-icon.svg"

[Icons]
Name: "{autoprograms}\Abdo ERP Local"; Filename: "{app}\Start-AbdoERP.cmd"
Name: "{commondesktop}\Abdo ERP Local"; Filename: "{app}\Start-AbdoERP.cmd"
Name: "{autoprograms}\Abdo ERP Local - Data"; Filename: "{commonappdata}\AbdoErpLocal"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\configure-lan.ps1"" -InstallRoot ""{app}"" -DataRoot ""{commonappdata}\AbdoErpLocal"""; StatusMsg: "جاري إعداد الخدمة وHTTPS والشبكة المحلية..."; Flags: runhidden waituntilterminated
Filename: "https://localhost"; Description: "فتح واجهة Abdo ERP Local"; Flags: shellexec postinstall skipifsilent nowait

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\scripts\remove-lan-services.ps1"" -InstallRoot ""{app}"" -DataRoot ""{commonappdata}\AbdoErpLocal"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveAbdoErpLocalServices"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Parameters: String;
begin
  Result := '';
  ExtractTemporaryFile('stop-lan-services.ps1');
  Parameters := '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\stop-lan-services.ps1') + '"';
  if not Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) then
  begin
    Result := 'تعذر تشغيل مرحلة إيقاف خدمات Abdo ERP Local قبل التحديث.';
    exit;
  end;
  if ResultCode <> 0 then
    Result := 'تعذر إيقاف خدمات Abdo ERP Local قبل التحديث. رمز الخطأ: ' + IntToStr(ResultCode);
end;
