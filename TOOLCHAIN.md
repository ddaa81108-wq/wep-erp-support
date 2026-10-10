# أدوات البناء والملفات المحمّلة

تاريخ التحقق: 2026-09-24.

## برامج الجهاز

| الأداة | الإصدار المتحقق منه | الاستخدام | الحالة |
|---|---:|---|---|
| Node.js | 24.16.0 | الخادم والبناء | كان مثبتًا ويعمل |
| npm | 11.13.0 | تثبيت حزم التطوير | كان مثبتًا ويعمل |
| Git | 2.55.0.windows.1 | إدارة المصدر وقراءة المرجع | كان مثبتًا ويعمل |
| Python | 3.14.5 | أدوات QA المساعدة عند الحاجة | كان مثبتًا ويعمل |
| .NET Framework | Release 533325 | تشغيل نسخة WinSW net461 | موجود ومتوافق؛ لا يلزم .NET SDK |
| Inno Setup | 6.7.3 | إنشاء مثبت Windows | ثُبت وتحقق تشغيل `ISCC.exe` |
| Caddy | 2.11.4 | HTTPS محلي وreverse proxy | ثُبت وتحقق تشغيله |
| mkcert | 1.4.4 | شهادات بيئة التطوير المحلية | ثُبت وتحقق تشغيله؛ لم تُثبت CA موثوقة بعد |
| WinSW | 3.0.0.0 (حزمة alpha.11) | تشغيل Node كخدمة Windows | ثُبت؛ لم تُنشأ الخدمة بعد |
| SQLite CLI | 3.53.4 | فحص القاعدة وعمليات الصيانة/النسخ | ثُبت وتحقق تشغيله |
| 7-Zip | 26.03 x64 | التغليف والفحص | ثُبت وتحقق تشغيله |

أضاف WinGet بعض المسارات إلى `PATH`. افتح Terminal جديدًا حتى تظهر aliases مثل `caddy` و`sqlite3` مباشرة.

## حزم المشروع

- React وReact DOM وLucide وMotion.
- Vite 7.3.6 وplugin React وTailwind tooling.
- TypeScript وVitest وتعريفات Node/React.
- Playwright 1.63.0 مع Chrome for Testing 153 وHeadless Shell وFFmpeg وWinldd.
- خطوط Cairo وJetBrains Mono محليًا من حزم Fontsource.
- `html-to-image` و`html2canvas` و`jspdf` و`fflate` للتصدير والنسخ.
- `fake-indexeddb` لاختبارات المسودات المحلية القادمة.

كل الإصدارات النهائية مقفلة في `package-lock.json`. آخر `npm audit` أعاد 0 ثغرات معلنة. تم استبعاد Vite 6.2.3 الموجود في المصدر لأنه يحمل تحذيرات أمنية، واعتمد Vite 7 المتوافق مع إضافات المشروع.

## ملفات المرجع والأصول

- `reference/cloud-source-ed602b37`: لقطة قراءة من مسارات الكود والتصميم والاختبارات اللازمة فقط؛ 207 ملفات، دون `.env` أو إعدادات خاصة أو بيانات إنتاج.
- `public/card-studio`: 38 ملفًا من أصول Card Studio المحلية، بما فيها الخطوط والخلفيات ونسخة `html2canvas` المحلية.
- `vendor/runtime`: Node portable وCaddy وWinSW وSQLite CLI مع التراخيص والchecksums.

## ما لم يُفعّل عمدًا

- لم يُثبت Firebase CLI أو Emulator أو PostgreSQL أو Docker؛ ليست متطلبات للتشغيل المحلي المختار.
- لم تُنشأ CA موثوقة ولم يُفتح جدار حماية ولم تُسجل خدمة Windows؛ هذه تغييرات أمن وتشغيل تُنفذ عند بناء إعداد LAN الفعلي.
- Chromium وInno Setup وأدوات البناء ليست جزءًا تلقائيًا من مثبت المستخدم النهائي.

شغّل `npm run verify:toolchain` للتحقق من ملفات runtime والحزم واختبار تشغيل Chromium.
