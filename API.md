# مرجع API المحلي — الإصدار 1

كل الردود JSON على الصورة `{ ok, data }` أو `{ ok: false, error }`. الخطأ يتضمن `code` و`correlationId`.

## عام

| الطريقة | المسار | المصادقة | الوصف |
|---|---|---|---|
| GET | `/api/health` | لا | حالة الخادم وإصدارات API/المخطط/الواجهة |
| GET | `/api/setup/status` | لا | هل يلزم إنشاء المدير الأول |
| POST | `/api/setup/admin` | لا، مرة واحدة | إنشاء أول مدير محلي تفاعليًا |
| POST | `/api/auth/login` | لا | إنشاء جلسة وإرجاع CSRF token |
| POST | `/api/auth/logout` | نعم | إلغاء الجلسة الحالية |
| GET | `/api/me` | نعم | هوية الجلسة والصلاحيات والإصدارات |
| GET | `/api/events?after=N` | نعم | SSE لاستئناف الأحداث بعد sequence |

## الموظفون

هذه المسارات للمدير فقط، وكل كتابة تتطلب CSRF وإصدار الواجهة مثل بقية عمليات الكتابة.

| الطريقة | المسار | الوصف |
|---|---|---|
| GET | `/api/users` | قائمة المستخدمين والصلاحيات القابلة للتعيين |
| POST | `/api/users` | إنشاء موظف محلي بصلاحيات محددة |
| PATCH | `/api/users/:id` | تعديل الاسم والحالة والصلاحيات أو إعادة كلمة المرور |

تعطيل الموظف أو إعادة كلمة مروره يلغي جلساته المفتوحة. تغيير الصلاحيات يصبح فعالًا في الطلب التالي، و`debts.write` يضيف `debts.read` تلقائيًا.

## العملاء

| الطريقة | المسار | الصلاحية | الوصف |
|---|---|---|---|
| GET | `/api/customers?limit=25&cursor=...` | `debts.read` | قائمة paginated مع الرصيد المشتق |
| POST | `/api/customers` | `debts.write` | إنشاء هوية عميل دائمة وسجل واحد؛ يرفض تكرار الاسم أو الهاتف |
| GET | `/api/customers/:id/ledger?limit=50&cursor=...` | `debts.read` | السجل الدائم المتسلسل للعميل |
| POST | `/api/customers/:id/transactions` | `debts.write` | دين أو سداد ذري |
| PATCH | `/api/customers/:id/pin` | `debts.write` | تثبيت/إلغاء تثبيت بطاقة العميل في العرض الذكي |
| POST | `/api/customers/:id/zero-review` | مدير فقط | مراجعة تصفير العميل دون تغيير مالي |
| POST | `/api/customers/:id/transactions/:transactionId/corrections` | `debts.write` | تصحيح حركة بسطر جديد مع إبقاء الأصل موثقًا |
| POST | `/api/customers/:id/transactions/:transactionId/cancel` | `debts.write` | إلغاء أثر حركة مع إبقاء صفها ظاهرًا في السجل |

العرض الذكي لا يحذف العميل. الكارت الصفري الذي ينتظر المراجعة يبقى ظاهرًا مهما طالت المدة، ويدخل مع بقية الكروت بترتيب آخر حركة مالية. بعد المراجعة ينتقل إلى مجموعة الأصفار أسفل القائمة، وتعود عليه قاعدة الإخفاء بعد 30 يومًا من الخمول إن لم يكن مثبتًا. البحث ومرشح «مسدد» يعيدان إظهاره. التسلسل لا يبدأ من جديد بعد الوصول إلى صفر، والكروت الصفرية لا تدخل في عدد الكروت النشطة حتى قبل المراجعة.

مسار `zero-review` يتطلب الجسم `{ "expectedFinancialVersion": 3 }` من `customer.zeroReview.financialVersion` ورؤوس الجلسة وCSRF. يرفض الموظف ولو امتلك `debts.write`، ويرجع `409 ZERO_REVIEW_CHANGED` إذا تغيّر الرصيد أو النسخة المالية. إعادة اعتماد نفس النسخة المعتمدة تعيد نجاحًا دون تكرار التدقيق أو الحدث. القائمة تقبل `filter=pending-review`، ويظل هذا الفلتر نافذًا مع البحث. الملخص الشامل يتضمن `pendingReviewCount`، والكارت يتضمن `zeroReview` بحالة الانتظار ونسخة الحركة ووقت المراجعة واسم المراجع. نجاح المراجعة ينشر `customer.changed` لتحديث باقي الشاشات.

المدير يتجاوز الصلاحيات الفرعية. كتابة حركات الحسابات التالية تتطلب:

- cookie جلسة HttpOnly.
- رأس `X-CSRF-Token`.
- رأس `X-Client-Api-Version: 1`.
- `requestId` داخل الجسم لمنع التكرار. لإنشاء حسابات الديون والأمانات وحركاتها، إعادة الطلب بنفس المحتوى تعيد الرد السابق؛ تغيير المحتوى مع المفتاح نفسه يرجع `409 REQUEST_ID_REUSED`. الطلبات القديمة بلا بصمة ترجع `409 LEGACY_REQUEST_REVIEW_REQUIRED`؛ راجع العملية المحفوظة ولا تنشئ مفتاحًا جديدًا تلقائيًا.
- `expectedVersion` عند إضافة حركة لحساب موجود.

مثال إنشاء دين:

```json
{
  "requestId": "c0bd0d89-10d6-4a2a-9f97-a8119db90bbb",
  "expectedVersion": 1,
  "type": "debt",
  "inputValue": 250,
  "calculationMode": "direct",
  "date": "2026-09-24T10:00:00.000Z",
  "note": "بيان تجريبي"
}
```

المرحلة الحالية تقبل `LYD` وconversion rate يساوي 1 فقط في هذا المسار. أي عملة أو معدل آخر يُرفض بكود واضح حتى لا تُخترع سياسة مالية.

## أكواد سلامة مهمة

| الكود | المعنى |
|---|---|
| `AUTH_REQUIRED` | لا توجد جلسة صالحة |
| `PERMISSION_DENIED` | الصلاحية مرفوضة من الخادم |
| `CSRF_REJECTED` | رمز حماية الكتابة غير صحيح |
| `CLIENT_VERSION_MISMATCH` | الواجهة قديمة وغير مسموح لها بالكتابة |
| `VERSION_CONFLICT` | سجل أحدث موجود؛ لا تُستبدل به المسودة القديمة |
| `REQUEST_ID_REQUIRED` | طلب مالي بلا مفتاح idempotency |
| `REQUEST_ID_REUSED` | أُعيد استخدام مفتاح الطلب مع محتوى مختلف |
| `LEGACY_REQUEST_REVIEW_REQUIRED` | الطلب محفوظ من إصدار سابق دون بصمة؛ راجع العملية الموجودة قبل المحاولة |
| `CUSTOMER_ALREADY_EXISTS` | الاسم أو الهاتف يعود لهوية عميل دائمة موجودة؛ يجب فتح سجلها بدل إنشاء نسخة |
| `CURRENCY_NOT_ENABLED_IN_FOUNDATION` | مسار العملة لم يعتمد بعد |

## هوية المؤسسة وحالة التشغيل

- `GET /api/organization-branding`: يحتاج جلسة صالحة للإداري أو الموظف، ويعيد `{ systemName }` للمؤسسة المرتبطة بالجلسة فقط. لا يمنح صلاحية قراءة الإعدادات الإدارية أو تعديلها.
- `GET /api/operations/health`: محمي بصلاحية الإدارة. `backupPolicy` و`restoreDrillStatus` قيمتهما `unverified` لأن الخادم لا يقرأ جدول Windows أو نتائج اختبار الاستعادة. سلامة SQLite الحالية ليست دليلًا على سلامة النسخ الاحتياطية.

## المصراوية — الحفظ التلقائي

- `GET /api/masraweya/day?date=YYYY-MM-DD`: يحتاج `masraweya.read`. غياب التاريخ يعيد يوم العمل الحالي: 04:00 إلى ما قبل 04:00 التالية في `Africa/Tripoli`، بحسب ساعة الخادم. القراءة لا تنشئ يومًا في قاعدة البيانات.
- `PUT /api/masraweya/day`: يحتاج `masraweya.write` مع الجلسة وCSRF وإصدار API. الجسم: `businessDate`, `expectedVersion`, `previousValueUnits`, `purchasesUnits`, `entries: [{valueUnits, commissionUnits}]`. الأرقام أعداد صحيحة آمنة، والمشتريات والقيم والعمولات غير سالبة، والجدول بحد أقصى 500 صف. ترتيب المصفوفة يحدد رقم الصف، وتبقى مواضع الصفوف الخالية محفوظة بين الصفوف المعبأة.
- اليوم الحالي والأيام السبعة السابقة، شاملة الحد الأقدم، قابلة للكتابة للمدير والإداريين والموظفين الحاصلين على `masraweya.write`. من دون هذه الصلاحية يُرفض الموظف من الخادم. ما قبل النافذة والمستقبل يرفض بكود `409 MASRAWEYA_DATE_LOCKED`؛ لا يوجد قيد إداري إضافي على الأيام السابقة.
- الرصيد السابق آلي من آخر يوم محفوظ قبله، مع عبور الأيام الخالية. تعديله يدويًا متاح لمن لديه صلاحية الكتابة في يوم البداية الأول فقط؛ خلاف ذلك يرجع `409 MASRAWEYA_OPENING_AUTOMATIC`. تصحيح يوم سابق ينقل فرق الرصيد إلى الأيام اللاحقة ذريًا، ويزيد إصداراتها دون تغيير صفوفها.
- تكرار نفس المحتوى المحفوظ يعيد نجاحًا مع `replayed: true` دون كتابة إضافية؛ محتوى مختلف بإصدار قديم يرجع `409 VERSION_CONFLICT`. هذا المسار لا يستخدم `requestId` الخاص بحركات الحسابات.
- الرد يتضمن `today`, `earliestEditableDate`, `editable`, `openingEditable`, `historicalAdjustmentUnits`, `carrySourceDate`, `version` والإجماليات. `editable` يمثل نافذة التاريخ، وعلى العميل جمعه مع صلاحيات المستخدم؛ والخادم يفرض الاثنين أيضًا.
- مسارا `POST /api/masraweya/day/finalize` و`POST /api/masraweya/day/correction` متقاعدان ويرجعان `410 MASRAWEYA_AUTOMATIC_WORKFLOW`. يجب تحديث الواجهة والخادم معًا وتحديث الصفحات المفتوحة عند التثبيت.

## التحديث الحي للإجماليات

تعيد قوائم الحسابات `summary.totalDebt` و`summary.activeCards` و`summary.netBalance` من كامل القسم، بصرف النظر عن البحث أو الصفحة المحملة. `netBalance` هو صافي الأرصدة الموقعة المستخدم للأمانات؛ الكارت النشط هو الكارت ذو الرصيد غير الصفري، موجبًا أو سالبًا، بصرف النظر عن التثبيت أو تاريخ آخر حركة. لا يؤثر هذا التعريف على ظهور الكروت أو ترتيبها.

تعيد `/api/collections` الكروت بترتيب موحد للإدارة والموظف: التوجيه الجديد والحركة المالية المباشرة الأحدث أولًا، ثم الجزئي، ثم الأمانة، ثم الصفر. الكروت المرفوضة لا تُعاد ضمن القائمة. تعديل إداري لاحق يتقدم على مجموعة اللون، بينما تقديم تحصيل الموظف أو اعتماده أو تسليم نقديته لا يُستخدم لتقديم الكارت. اللون أزرق للدين الجديد، أصفر للجزئي، أخضر للرصيد السالب، أسود للصفر، وأحمر للصفر بعد تسليم النقدية دون نقدية معتمدة معلقة. قرار الرفض ينهي التوجيه (`cancelled`) ذريًا وينشر حدث تحديث الاستلامات وإلغاء التوجيه في قسم الديون؛ لا يُحذف حساب العميل أو حركاته. يمكن توجيه الحساب مجددًا بتكليف جديد. تُستبعد الاستلامات المستقلة المرفوضة كذلك. يعيد `outstandingCancelledSubmissions` الدفعات السابقة المعتمدة ذات النقدية غير المسلّمة، حتى تبقى قابلة للتسليم بعد انتهاء التوجيه. تظل الاستلامات المعلقة غير مؤثرة على الرصيد المالي حتى اعتمادها؛ لم تتغير الصلاحيات أو دورة الاعتماد.

تجمع الواجهة أحداث SSE المتقاربة ثم تجلب لقطة حديثة في الخلفية دون إعادة تحميل الصفحة. لا تحفظ مؤشر الحدث قبل نجاح التحديث، وتعيد المحاولة بعد فشل الطلب، وتعيد المزامنة عند استرجاع الاتصال أو العودة للتبويب. تؤجل تحديث مسودة المشتريات حتى انتهاء تحريرها.

قد يتلقى صاحب صلاحية الخزينة أو التقارير حدث `financial.summary.changed` عندما لا يملك صلاحية القسم المصدر. يحمل الحدث `aggregateId: null` و`payload: {}` فقط مع تسلسله وتوقيته، لإعادة جلب الإجماليات المسموح بها دون كشف الحساب المصدر. يستمر عزل المؤسسات وفحص الصلاحيات في الخادم.


## Browser push (schema 47)

Authenticated admin or employee with collections.read; existing CSRF, same-origin and API-version guards apply to mutations.

- GET /api/browser-push/config: ready, publicKey, and endpoints for the current session only. Never exposes the VAPID private key.
- POST /api/browser-push/subscription: standard PushSubscription JSON (endpoint, keys.p256dh, keys.auth); binds to authenticated user, organization and session, max 10 devices per user. Known HTTPS push-provider endpoints only.
- DELETE /api/browser-push/subscription: {endpoint}; removes only this user's subscription.
- POST /api/browser-push/test: {endpoint}; queues a generic test, limited to once per minute per subscription. Response queued:true means accepted, not delivered.

Notification inserts enqueue new recipient deliveries transactionally. Background dispatch sends encrypted generic payloads and validates active session/account/permissions. Delivery stops on logout or session expiry.


## Database monitor

GET /api/operations/database-monitor is read-only and requires the admin owner of the sole organization, using the same server guard as emergency backups. Returns active database file sizes, logical allocation/free pages, available disk space, configured backup folder metadata and up to 100 recent SQLite entries with creation-report status. No file download, deletion, integrity scan or restore is performed. Client-supplied filesystem paths are not accepted.
