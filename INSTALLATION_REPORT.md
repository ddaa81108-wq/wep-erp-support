# تقرير بيئة Windows وLAN

آخر تثبيت وتحقق فعلي: 2026-09-27.

## الموجود على الجهاز

- مسار البرنامج: `C:\Program Files\Abdo ERP Local`.
- مسار البيانات: `C:\ProgramData\AbdoErpLocal`.
- رابط LAN يُقرأ من `C:\ProgramData\AbdoErpLocal\lan-config.json` لأن DHCP قد يغيّره.
- الإصدار المثبت لكل مستخدمي الجهاز: `0.9.1-google-entry`.
- خدمتا `AbdoErpLocal` و`AbdoErpLocalProxy` في حالة Running وببدء Automatic.
- Node يستمع داخليًا على `127.0.0.1:4310`، وتستقبل بوابة Caddy اتصال LAN عبر HTTPS.
- قاعدة Firewall مقيدة بـPrivate وLocalSubnet وTCP/443، ولا تفتح SQLite أو المنفذ 4310 للشبكة.
- شهادة CA المحلية مثبتة في LocalMachine Trusted Root، والمفتاح الخاص لا يُنقل لأي جهاز.

## نتيجة التحقق

- رابط LAN الذي نجح اختباره: `https://10.240.95.41`.
- `/api/health`: الحالة `ready` والإصدار `0.9.1-google-entry` والمخطط `6`.
- HTTPS نجح في Chromium على `https://localhost` وعنوان LAN دون تجاوز خطأ الشهادة.
- `PRAGMA quick_check`: النتيجة `ok`.
- البيانات بقيت دون حذف أو توليد أثناء التثبيت: عميل واحد، و7 حركات وقت التحقق.
- خدمتا Windows ظهرتا بالحالة `RUNNING` بعد التحديث.
- قاعدة Firewall مفعلة على Private وLocalSubnet وTCP/443 فقط.
- لم تُؤخذ نسخة من قاعدة البيانات، ولم تُنفذ عملية نشر خارجي.

## أداة المثبت

ملفات Inno Setup وWinSW وCaddy وشهادة LAN محفوظة. ملف التثبيت المستخدم:

`dist\installer\Abdo-ERP-Local-Setup-0.9.1-google-entry.exe`

- الحجم: 51.33 MiB.
- SHA-256: `96B65A730F2ECE0AC12ED5FADC2007E3F7243F58CE59B7B755A4990C02653069`.
- سجل المثبت: `dist\installer\install-0.9.1-final.log`، وينتهي بنجاح التثبيت العام وعدم الحاجة لإعادة تشغيل Windows.
- تحقق Chromium المثبت نجح على localhost وLAN، وفحص SQLite أعاد `ok` والمخطط `6`.
