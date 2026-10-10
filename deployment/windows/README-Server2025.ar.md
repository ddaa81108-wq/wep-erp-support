# تجهيز Abdo ERP على Windows Server 2025

الحزمة المستهدفة هي `Abdo-ERP-Local-Setup-0.14.0.exe`. تضم الواجهة والخادم، وNode.js 24.16.0 وCaddy 2.11.4 وWinSW 3.0.0-alpha.11 وSQLite 3.53.4 وmkcert 1.4.4. لا يلزم تنزيل Node أو npm أو Inno Setup على السيرفر. Inno Setup مطلوب فقط على جهاز بناء المثبّت.

## قبل التثبيت

- استخدم Windows Server 2025 بنواة x64 وواجهة سطح مكتب، مع حساب إداري لتثبيت خدمات Windows.
- تأكد من وجود عنوان IPv4 ثابت أو حجز DHCP، ومن أن المنفذ 443 غير مشغول.
- مسار التثبيت `C:\Program Files\Abdo ERP Local` ومسار البيانات `C:\ProgramData\AbdoErpLocal`. لا تنقل قاعدة SQLite وهي مفتوحة؛ استخدم أداة النسخ الاحتياطي والاستعادة.
- الشبكة يجب أن تكون `Private` أو `DomainAuthenticated`، وبشرط أن تكون شبكة موثوقة فعلًا. المثبّت يفتح HTTPS للـ `LocalSubnet` فقط، ولا يجعل النظام متاحًا عبر الإنترنت. لا تغيّر شبكة عامة إلى Private لمجرد نجاح التثبيت.
- لا تنقل بيانات التجارب تلقائيًا إلى السيرفر الجديد. القرار بشأن نقلها أو بدء قاعدة جديدة يجب أن يكون صريحًا.

## نقل الحزمة

ابنِ المثبّت على جهاز المشروع بالأمر:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-installer.ps1
```

انقل ملفَي `dist\installer\Abdo-ERP-Local-Setup-0.14.0.exe` و`dist\installer\Install-AbdoERP-WindowsServer2025.ps1` إلى مجلد واحد على السيرفر عبر قناة نقل موثوقة. سجّل قيمة SHA-256 التي يعرضها البناء، ثم تحقق منها على السيرفر.

## التثبيت

افتح Windows PowerShell كمسؤول داخل مجلد الملفين، ثم:

```powershell
$erpInstaller = (Resolve-Path '.\Abdo-ERP-Local-Setup-0.14.0.exe').Path
$erpHash = 'ضع_بصمة_SHA256_التي_خرجت_من_جهاز_البناء'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\Install-AbdoERP-WindowsServer2025.ps1' -SourceInstaller $erpInstaller -ExpectedSha256 $erpHash
```

إذا كان للمثبّت رابط تنزيل HTTPS خاص بك، يمكن الاستعاضة عن `-SourceInstaller` بـ `-PackageUrl 'https://example.com/Abdo-ERP-Local-Setup-0.14.0.exe'`، مع إبقاء بصمة SHA-256 إلزامية. لا تستخدم رابطًا غير موثوق أو رابطًا يكشف ملفات المشروع للعامة.

إذا كان التطبيق مثبتًا بالفعل، يتوقف السكربت لحماية البيانات. بعد نسخة احتياطية ومراجعة الترقية يمكن استخدام `-AllowUpgrade`.

## التشغيل والتحقق

يسجل المثبّت خدمتي `AbdoErpLocal` و`AbdoErpLocalProxy` ببداية تلقائية مع Windows، ويضع اختصارًا على سطح المكتب وملفًا مباشرًا باسم `C:\Program Files\Abdo ERP Local\Start-AbdoERP.cmd`. فتحه يبدأ الخدمات إن توقفت ويفتح `https://localhost/erp`.

```powershell
Get-Service AbdoErpLocal,AbdoErpLocalProxy | Select-Object Name,Status,StartType
& 'C:\Program Files\Abdo ERP Local\scripts\verify-lan-install.ps1'
Get-Content 'C:\ProgramData\AbdoErpLocal\lan-config.json'
```

على الأجهزة الأخرى داخل الشبكة استخدم عنوان `url` الظاهر في `lan-config.json`. شهادة HTTPS محلية؛ يلزم تثبيت شهادة الجذر المخصصة على الأجهزة الموثوقة قبل استخدامها. الوصول من خارج الشبكة يحتاج إعدادًا منفصلًا بنطاق وشهادة موثوقين أو شبكة VPN، وليس فتح منفذ 443 للعالم مباشرة.

بعد بدء التشغيل الفعلي قرر جدول النسخ الاحتياطية واختبر الاستعادة قبل الاعتماد على النظام:

```powershell
& 'C:\Program Files\Abdo ERP Local\scripts\configure-backup-task-admin.ps1'
# للتفعيل بقرارك بعد بدء البيانات الفعلية:
# & 'C:\Program Files\Abdo ERP Local\scripts\configure-backup-task-admin.ps1' -Activate
```
