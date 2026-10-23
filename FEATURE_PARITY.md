# جرد المطابقة الوظيفية — 23 أكتوبر 2026

مرجع المراجعة: `dc4861c65a81c4c4eff3331da9462c5f1766028c`، مخطط قاعدة البيانات 52. يصف هذا الملف ERP المحلي الحالي، وليس شهادة اعتماد للإنتاج أو مطابقة Android. يبقى `SOURCE_BASELINE.md` مرجع المصدر القديم؛ أسماء ملفاته لا تثبت وجود تنفيذ محلي.

## دلالات الحالة وحدود الأدلة

- **منفّذ وله اختبارات:** كود محلي مع اختبارات محددة. نتائج تشغيل هذه المراجعة في `docs/QUALITY_VERIFICATION_2026-10-23.ar.md`.
- **منفّذ؛ قبول يدوي مطلوب:** المسار موجود، ولم نعد فحص واجهته أو ملفه المصدّر في هذه المراجعة.
- **غير مثبت كميزة مستقلة:** لم يظهر مقابل محلي أثناء الجرد؛ هذه حالة نطاق وليست عيب تشغيل أو تكليفًا بتنفيذه.

تشغيل التغطية يشمل `tests/*.test.ts`؛ اختبارات المتصفح المستقلة `tests/*-ui.ts` لا تعمل ضمنه. ذكر ملف متصفح هنا لا يعني إعادة تشغيله في هذه المراجعة. نجاح الاختبارات ونسبة التغطية لا يثبتان اكتمال كل الوظائف أو خلو المنظومة من الأخطاء.

## الدخول والعرض والأدوات

| الوظيفة | التنفيذ المحلي ودليل الاختبار | الحالة والحدود |
|---|---|---|
| الدخول والجلسة وCSRF والصلاحيات | `src/server/security/sessions.ts`، `src/server/routes/accountRoutes.ts`؛ `tests/foundation.test.ts`، `tests/http-contracts.test.ts` | منفّذ وله اختبارات لتدوير CSRF والصلاحيات ورفض الطلبات |
| Google والتحقق بخطوتين | `src/server/modules/accounts/googleAuth.ts`، `src/server/security/mfa.ts`، `src/client/sections/settings/AccountSecurityManager.tsx`؛ `tests/securityHardening.test.ts`، `tests/review-hardening.test.ts`، `tests/foundation.test.ts` | منفّذ وله اختبارات؛ لا يعني إجراء دخول Google خارجي فعلي الآن |
| العربية والإنجليزية | `src/client/i18n/`؛ `tests/language.test.ts`؛ متصفح مستقل `tests/languages-ui.ts` | منفّذ وله اختبارات؛ لا ندّعي مراجعة لغوية بشرية لكل شاشة |
| الثيمان ووضوح الكتابة | `src/client/assistant/DashboardUtilityBar.tsx`، `src/client/components/Readability.tsx`؛ متصفح مستقل `tests/readability-ui.ts` | منفّذ؛ قبول العرض مطلوب عند تغييره |
| البحث الموحد في الحسابات | `src/client/assistant/GlobalAccountSearch.tsx`؛ مسارات البحث في `tests/foundation.test.ts`؛ متصفح مستقل `tests/search-focus-ui.ts` | منفّذ؛ يصحح وصف البحث العام بأنه مفقود؛ نطاقه الحسابات المسموح بها، وليس كل حقل بكل قسم |
| صندوق الإشعارات وWeb Push | `src/client/assistant/NotificationCenter.tsx`، `src/server/domain/notifications.ts`، `src/server/routes/browserPushRoutes.ts`؛ `tests/notifications.test.ts`، `tests/browser-push.test.ts`، `tests/browser-push-worker.test.ts` | منفّذ وله اختبارات؛ يصحح وصف الصندوق بأنه غير منفّذ؛ التسليم الحقيقي يعتمد أيضًا على إذن الجهاز وخدمة Push |
| الاتصال والقراءات والتحديث اللحظي | `src/client/assistant/SyncStatus.tsx`، `notificationRealtime.ts`؛ `tests/apiTransportReads.test.ts`، `tests/pendingReads.test.ts`، `tests/foundation.test.ts`؛ متصفح مستقل `tests/realtime-ui.ts` | منفّذ وله اختبارات؛ التغطية ليست اختبار استقرار الإنترنت الفعلي |
| الحاسبة العامة والملاحظات والتذكيرات واستوديو الكروت | لم يظهر مقابل مستقل للميزات القديمة في جرد `src/client` و`src/server` | غير مثبت كميزة مستقلة؛ ليست عيوب تشغيل مؤكدة |

## الأقسام والحسابات المالية

| الوظيفة | التنفيذ المحلي ودليل الاختبار | الحالة والحدود |
|---|---|---|
| العملاء والشركات والأمانات LYD وEGP | `src/server/domain/customerAccountCommands.ts`، `customerTransactions.ts`، `customerQueries.ts`؛ `tests/foundation.test.ts`، `tests/account-lifecycle-isolation.test.ts`، `tests/sectionSnapshots.test.ts` | منفّذ وله اختبارات للأرصدة والصفحات والعزل؛ الحسابات المصرية المرتبطة تقرأ مصادرها المخصصة |
| الدين والسداد والتعارض وإعادة الطلب | `src/server/domain/customerTransactionSupport.ts`، `customerTransactions.ts`؛ `tests/reliability.test.ts`، `tests/financial-invariants.test.ts`، `tests/decimal-factors.test.ts` | منفّذ وله اختبارات؛ سياسة التقريب الحالية لم تتغير |
| مراجعة الحسابات الصفرية | `tests/customer-zero-review.test.ts`؛ متصفح مستقل `tests/customer-zero-review-ui.ts` | منفّذ وله اختبارات؛ إخفاء العرض لا يحذف الدفتر |
| المشتريات والترحيل والتصحيح والباقي المتحرك | `src/server/domain/purchaseEntryCommands.ts`، `purchaseDayCommands.ts`، `purchaseSupport.ts`؛ `tests/purchase-running-balance.test.ts`، `tests/foundation.test.ts`؛ متصفح مستقل `tests/purchase-running-ui.ts` | منفّذ وله اختبارات؛ الباقي يبدأ بالمرحل ويتأثر بالمعاملات؛ اليوم المرحّل لا يعدّل دون فتح التصحيح |
| المصراوية والربط بالمصدر المصري | `src/server/domain/masraweya.ts`، `linkedAccounts.ts`؛ `tests/masraweyaAccess.test.ts`، `tests/masraweyaEditor.test.ts`، `tests/masraweyaCorrection.test.ts` | منفّذ وله اختبارات؛ قيود تواريخ خاصة بالقسم |
| الخزينة والتحويل | `src/server/domain/treasury.ts`، `treasuryQueries.ts`؛ `tests/foundation.test.ts`، `tests/financial-invariants.test.ts` | منفّذ وله اختبارات؛ دفتر الأموال النشطة مستقل ولا تساوي حركته بالضرورة مجموع التحصيلات المعتمدة |
| التقارير وصافي الخامسة صباحًا | `src/client/sections/reports/ReportsSection.tsx`، `src/server/domain/reports/reports.ts`، `fiveAmClosing.ts`؛ `tests/report-commit.test.ts`، `tests/report-closing.test.ts` | منفّذ وله اختبارات؛ يصحح وصف التقارير بأنها مفقودة؛ صافي الخامسة لقطة ثابتة وليس قفل فترة عامًّا |
| التحصيل المرتبط واعتماده والأقساط المتعددة | `src/server/domain/collections.ts`، `src/client/employee/collections/pendingCollectionRequests.ts`؛ `tests/collection-idempotency.test.ts`، `tests/foundation.test.ts`؛ متصفح مستقل `tests/collection-idempotency-ui.ts` | منفّذ وله اختبارات؛ إعادة الطلب المرتبط تعيد النتيجة، والدفعات الجزئية المستقلة مسموحة |
| الاستلام غير المرتبط | `src/server/domain/collections.ts`، `src/server/db/migrationsUnlinkedCurrency.ts`، `src/client/admin/collections/UnlinkedReceiptsPanel.tsx`؛ `tests/unlinked-collections.test.ts`، `tests/unlinked-currency.test.ts` | منفّذ وله اختبارات؛ LYD فقط بقرار العمل، ورفض الربط بحساب EGP خادميًا؛ المخالفة القديمة تظهر للمراجعة دون تعديل رصيد؛ عقد إعادة الطلب لكل مسار موضح في `API.md` |
| الرواتب وتنبيه التشابه | `src/server/domain/collectionPayroll.ts`، `duplicateWarning.ts`؛ `tests/payroll.test.ts`، `tests/duplicateWarning.test.ts` | منفّذ وله اختبارات؛ تنبيه التشابه مختلف عن ضمان إعادة نفس الطلب |
| المطابقة المالية | `src/server/domain/financialReconciliation.ts`، `scripts/reconcile-financials.ts`؛ `tests/financial-reconciliation.test.ts` | أداة قراءة فقط منفّذة ومختبرة؛ لا صفحة مستقلة؛ الحدود في `docs/FINANCIAL_RECONCILIATION.ar.md` |

## الإدارة والتصدير والاستعادة

| الوظيفة | التنفيذ المحلي ودليل الاختبار | الحالة والحدود |
|---|---|---|
| الموظفون والإعدادات والتدقيق والأستاذ | `src/client/sections/settings/`، `src/server/routes/userManagementRoutes.ts`؛ `tests/foundation.test.ts`، `tests/auditRegressions.test.ts`، `tests/section-contracts.test.ts` | منفّذ وله اختبارات؛ لا ندّعي إثباتًا تشفيريًا ضد إعادة كتابة قاعدة البيانات كاملة |
| مركز التشغيل ومراقبة قاعدة البيانات | `src/client/sections/settings/OperationsCenterManager.tsx`، `src/client/database-monitor/`، `src/server/domain/operationsCenter.ts`؛ `tests/database-monitor.test.ts`، `tests/database-activity.test.ts` | منفّذ وله اختبارات؛ يصحح وصفه بأنه بلا شاشة؛ مؤشرات النسخ الخارجية والتدريب غير المتحققة ليست نجاحًا مثبتًا |
| النسخ التلقائي والطارئ والاستعادة | `src/client/sections/settings/BackupCenterManager.tsx`، `src/server/domain/emergencyBackup.ts`، `scripts/backup-database.mjs`، `scripts/restore-drill.mjs`؛ `tests/emergencyBackup.test.ts`، `tests/restoreWorker.test.ts`، `tests/securityHardening.test.ts` | منفّذ وله اختبارات؛ توجد واجهة وليست سكربتات فقط؛ تدريب الاستعادة التجريبي نجح على مخطط 52، ولا يثبت وجود نسخة ومفاتيح خارج الجهاز |
| كشف استلامات PDF وصورة جدول المصراوية | `src/client/admin/collections/AdminCollectionsSection.tsx`، `src/client/sections/masraweya/masraweyaCapture.ts` | منفّذ في الكود؛ قبول يدوي مطلوب؛ ليس تصديرًا شاملًا لكل الأقسام |
| استيراد Excel والتصدير الشامل وطباعة السجل الموحد | لم يظهر تنفيذ شامل مقابل أثناء الجرد؛ مكتبة PDF وحدها لا تثبت اكتمال هذه الوظائف | غير مثبت كميزة شاملة؛ لا يصح وصف كل التصدير بأنه مفقود |
| سلة مهملات وظيفية ومسار تنفيذ البريد/اليدوي/بطاقة/حساب/بنك القديم | `deleted_at` وحده ليس سلة استعادة؛ لم يظهر مقابل مستقل لمسار التنفيذ القديم | خارج التنفيذ المرصود؛ السياسات الجديدة قرار منتج |

## حدود الاعتماد

- **قفل فترة موحد لكل الأقسام غير مطلوب بقرار المستخدم.** غيابه ليس عيبًا أو بند إصلاح؛ تبقى قواعد الأقسام ولقطات التقارير كما هي.
- بوابة Abdo Cash القديمة ومشروع Android المستقل خارج اعتماد هذه المراجعة. لا يُخلطان بتحصيل ERP أو المصراوية؛ لكل منهما عقد واختبارات منفصلة.
- لم تنشر هذه المراجعة إصدارًا ولم تغيّر الحسابات أو الواجهة أو البيانات الحقيقية. لم يُعد اختبار حمل طويل أو أجهزة فعلية متعددة أو تعطل جهاز كامل.
- نتائج القياس وحدوده في `docs/QUALITY_VERIFICATION_2026-10-23.ar.md`؛ التقارير التاريخية ليست دليل نجاح تلقائيًا للكوميت الحالي.
