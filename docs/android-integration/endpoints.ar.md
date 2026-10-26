# نقاط اتصال تطبيق Android

نسخة المصدر: 537f073e8fc76ec2ee9120a198272413d5ea68d9. جميع الأمثلة من بيانات مصطنعة. راجع README.ar.md لقواعد العملات والأمان والترقيم.

الأخطاء العامة للطلبات المصادق عليها: 401 AUTH_REQUIRED،403 CSRF_REJECTED/PERMISSION_DENIED،409 CLIENT_VERSION_MISMATCH. أخطاء الحقول400، والمسار404، والاستثناء غير المتوقع500. لا تفترض أن كل عملية تصدر كل أخطاء409؛ راجع وصف العملية وerror-catalog.json.

## POST /api/auth/login

الدخول. الصلاحية: `public`.

Set-Cookie abdo_session; retain CookieJar. MFA_REQUIRED sets abdo_mfa instead. LOGIN_BUSY returns Retry-After: 2.

طلب JSON (مثال):

```json
{
  "username": "android-collector",
  "password": "<private password>"
}
```

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "a9e84beb-8b4e-4cd6-8788-7be5cce76d64",
      "username": "android-admin",
      "displayName": "مدير الاختبار",
      "role": "admin",
      "isOwner": true,
      "mustChangePassword": false,
      "permissions": []
    },
    "csrfToken": "<session-csrf-token>",
    "expiresAt": "2026-10-23T10:33:42.544Z",
    "apiVersion": "1"
  }
}
```

## POST /api/auth/mfa/verify

إكمال الدخول الثنائي. الصلاحية: `public`.

Requires abdo_mfa challenge cookie; success creates abdo_session.

طلب JSON (مثال):

```json
{
  "code": "123456"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "a9e84beb-8b4e-4cd6-8788-7be5cce76d64",
      "username": "android-admin",
      "displayName": "مدير الاختبار",
      "role": "admin",
      "isOwner": true,
      "mustChangePassword": false,
      "permissions": []
    },
    "csrfToken": "<session-csrf-token>",
    "expiresAt": "2026-10-23T10:33:42.544Z",
    "apiVersion": "1"
  }
}
```

## GET /api/me

المستخدم والصلاحيات. الصلاحية: `authenticated`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "a9e84beb-8b4e-4cd6-8788-7be5cce76d64",
      "username": "android-admin",
      "displayName": "مدير الاختبار",
      "role": "admin",
      "isOwner": true,
      "mustChangePassword": false,
      "permissions": []
    },
    "apiVersion": "1",
    "schemaVersion": "50"
  }
}
```

## GET /api/auth/csrf

تدوير رمز CSRF. الصلاحية: `authenticated`.

Rotates token and invalidates the previous one for this session. Do not run concurrently with writes.

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "csrfToken": "<new token>"
  }
}
```

## POST /api/auth/logout

الخروج. الصلاحية: `authenticated`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "loggedOut": true
  }
}
```

## POST /api/auth/change-password

تغيير كلمة المرور. الصلاحية: `authenticated`.

Revokes other sessions; leaves this session active.

طلب JSON (مثال):

```json
{
  "currentPassword": "<current>",
  "newPassword": "<new with letters and digits>"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "changed": true
  }
}
```

## GET /api/organization-branding

هوية المؤسسة. الصلاحية: `authenticated`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "systemName": "اختبار Android — بيانات مصطنعة"
  }
}
```

## GET /api/health

إصدار الخادم وحالته. الصلاحية: `public`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "status": "ready",
    "apiVersion": "1",
    "schemaVersion": "50",
    "uiVersion": "0.15.0",
    "build": {
      "version": "0.15.0",
      "commit": null,
      "builtAt": null,
      "dirty": false
    },
    "time": "2026-10-22T22:33:44.700Z"
  }
}
```

## GET /api/customers

قائمة الحسابات وإجمالي القسم. الصلاحية: `debts.read`.

summary is global to section; totalItems is filtered. Do not sum loaded cards to obtain totals.

المعاملات: `q` (Normalized name/phone search; most filters are bypassed when search is nonempty.)، `filter` ({"type":"string","enum":["all","smart","today","due","settled","pinned","pending-review"]})، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200})، `cursor` (Opaque nextCursor from previous response.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "0342102a-b304-4e81-a4b7-a08081516bfa",
        "name": "عميل تحصيل الاختبار",
        "phone": null,
        "version": 2,
        "activeCycleId": "0a36934d-f387-42c2-8a45-460d5e5df8ed",
        "openingBalanceUnits": 0,
        "balanceUnits": 300,
        "currency": "LYD",
        "isPinned": false,
        "inactiveSince": null,
        "zeroReview": {
          "pending": false,
          "financialVersion": 1,
          "reviewedAt": null,
          "reviewedByName": null
        },
        "hiddenFromDefault": false,
        "debtStartedAt": "2026-10-22T22:33:25.074Z",
        "debtAgeDays": 0,
        "activeAssigneeName": "محصل الاختبار",
        "systemManaged": false,
        "systemLinkKey": null,
        "nextSequence": 3,
        "createdAt": "2026-10-22T22:33:25.074Z",
        "updatedAt": "2026-10-22T22:33:25.561Z"
      },
      {
        "id": "f10ba11d-03b3-411b-a7c9-83fd74347002",
        "name": "عميل المطابقة باء",
        "phone": null,
        "version": 1,
        "activeCycleId": "27e100cd-624c-4d7f-bbc3-f143a64d180a",
        "openingBalanceUnits": 0,
        "balanceUnits": 250,
        "currency": "LYD",
        "isPinned": false,
        "inactiveSince": null,
        "zeroReview": {
          "pending": false,
          "financialVersion": 0,
          "reviewedAt": null,
          "reviewedByName": null
        },
        "hiddenFromDefault": false,
        "debtStartedAt": "2026-10-22T22:33:25.025Z",
        "debtAgeDays": 0,
        "activeAssigneeName": null,
        "systemManaged": false,
        "systemLinkKey": null,
        "nextSequence": 2,
        "createdAt": "2026-10-22T22:33:25.025Z",
        "updatedAt": "2026-10-22T22:33:25.025Z"
      },
      {
        "id": "0850d816-6dc0-4d85-b46f-fb0a6ef1cb11",
        "name": "عميل المطابقة ألف",
        "phone": null,
        "version": 1,
        "activeCycleId": "951e9460-9aee-4cd3-ad5d-c3c6ada272d2",
        "openingBalanceUnits": 0,
        "balanceUnits": 1000,
        "currency": "LYD",
        "isPinned": false,
        "inactiveSince": null,
        "zeroReview": {
          "pending": false,
          "financialVersion": 0,
          "reviewedAt": null,
          "reviewedByName": null
        },
        "hiddenFromDefault": false,
        "debtStartedAt": "2026-10-22T22:33:24.984Z",
        "debtAgeDays": 0,
        "activeAssigneeName": null,
        "systemManaged": false,
        "systemLinkKey": null,
        "nextSequence": 2,
        "createdAt": "2026-10-22T22:33:24.984Z",
        "updatedAt": "2026-10-22T22:33:24.984Z"
      }
    ],
    "nextCursor": null,
    "totalItems": 3,
    "summary": {
      "netBalance": 1550,
      "totalDebt": 1550,
      "activeCards": 3,
      "pendingReviewCount": 0
    }
  }
}
```

## POST /api/customers

إنشاء حساب دائم. الصلاحية: `debts.write`.

Replay returns same response with meta.replayed:true. Duplicate identity rejected; see domain error catalog.

طلب JSON (مثال):

```json
{
  "name": "حساب اختبار جديد",
  "openingBalance": 1000,
  "requestId": "example-new-account-0001"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "0342102a-b304-4e81-a4b7-a08081516bfa",
      "name": "عميل تحصيل الاختبار",
      "phone": null,
      "version": 2,
      "activeCycleId": "0a36934d-f387-42c2-8a45-460d5e5df8ed",
      "openingBalanceUnits": 0,
      "balanceUnits": 300,
      "currency": "LYD",
      "isPinned": false,
      "inactiveSince": null,
      "zeroReview": {
        "pending": false,
        "financialVersion": 1,
        "reviewedAt": null,
        "reviewedByName": null
      },
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.074Z",
      "debtAgeDays": 0,
      "activeAssigneeName": "محصل الاختبار",
      "systemManaged": false,
      "systemLinkKey": null,
      "nextSequence": 3,
      "createdAt": "2026-10-22T22:33:25.074Z",
      "updatedAt": "2026-10-22T22:33:25.561Z"
    }
  }
}
```

## GET /api/customers/suggestions

اقتراحات حسابات موجودة. الصلاحية: `debts.read`.



المعاملات: `q` (At least 2 characters; up to 8 results.).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "0342102a-b304-4e81-a4b7-a08081516bfa",
        "name": "عميل تحصيل الاختبار",
        "phone": null,
        "balanceUnits": 300,
        "currency": "LYD"
      }
    ]
  }
}
```

## GET /api/customers/{id}

تفاصيل الحساب. الصلاحية: `debts.read`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "0342102a-b304-4e81-a4b7-a08081516bfa",
    "name": "عميل تحصيل الاختبار",
    "phone": null,
    "version": 2,
    "activeCycleId": "0a36934d-f387-42c2-8a45-460d5e5df8ed",
    "openingBalanceUnits": 0,
    "balanceUnits": 300,
    "currency": "LYD",
    "isPinned": false,
    "inactiveSince": null,
    "zeroReview": {
      "pending": false,
      "financialVersion": 1,
      "reviewedAt": null,
      "reviewedByName": null
    },
    "hiddenFromDefault": false,
    "debtStartedAt": "2026-10-22T22:33:25.074Z",
    "debtAgeDays": 0,
    "activeAssigneeName": "محصل الاختبار",
    "systemManaged": false,
    "systemLinkKey": null,
    "nextSequence": 3,
    "createdAt": "2026-10-22T22:33:25.074Z",
    "updatedAt": "2026-10-22T22:33:25.561Z"
  }
}
```

## PATCH /api/customers/{id}

تعديل هوية الحساب. الصلاحية: `debts.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "name": "اسم معدل للاختبار"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
    "name": "اسم معدل للاختبار",
    "phone": null,
    "customerVersion": 2
  }
}
```

## GET /api/customers/{id}/ledger

كشف الحساب ورصيد الصفحة الافتتاحي. الصلاحية: `debts.read`.

Use customer.balanceUnits and pageOpeningBalanceUnits, ignoring reversed rows in running balance. nextCursor is supplied as before.

المعاملات: `before` (Pass nextCursor as before, not as cursor.)، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200}).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "0342102a-b304-4e81-a4b7-a08081516bfa",
      "name": "عميل تحصيل الاختبار",
      "phone": null,
      "version": 2,
      "openingBalanceUnits": 0,
      "balanceUnits": 300,
      "currency": "LYD",
      "isPinned": false,
      "inactiveSince": null,
      "nextSequence": 3,
      "activeCycleId": "0a36934d-f387-42c2-8a45-460d5e5df8ed",
      "zeroReview": {
        "pending": false,
        "financialVersion": 1,
        "reviewedAt": null,
        "reviewedByName": null
      },
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.074Z",
      "debtAgeDays": 0,
      "activeAssigneeName": "محصل الاختبار",
      "systemManaged": false,
      "systemLinkKey": null,
      "createdAt": "2026-10-22T22:33:25.074Z",
      "updatedAt": "2026-10-22T22:33:25.561Z"
    },
    "pageOpeningBalanceUnits": 0,
    "totalItems": 1,
    "items": [
      {
        "id": "bccb4ebf-899c-4170-8df3-f742edaebc4b",
        "type": "debt",
        "amountUnits": 1000,
        "currency": "LYD",
        "paymentMode": null,
        "calculationMode": "direct",
        "inputValue": 1000,
        "factorMicros": null,
        "transactionDate": "2026-10-22T22:33:24.984Z",
        "referenceNo": "CUST-00000001",
        "note": "رصيد افتتاحي",
        "displayNote": "رصيد افتتاحي",
        "actorName": "مدير الاختبار",
        "actorIsOwner": true,
        "sequence": 1,
        "status": "posted",
        "correctsTransactionId": null,
        "createdAt": "2026-10-22T22:33:24.984Z",
        "updatedAt": "2026-10-22T22:33:24.984Z"
      }
    ],
    "nextCursor": null
  }
}
```

## PATCH /api/customers/{id}/pin

تثبيت الكارت. الصلاحية: `debts.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "isPinned": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
    "isPinned": true,
    "customerVersion": 2
  }
}
```

## POST /api/customers/{id}/transactions

دين أو دفعة جزئية أو كلية. الصلاحية: `debts.write`.

Signed balances allowed; partial overpayment is NOT rejected. full uses current positive balance after validating inputValue. requestId+payload fingerprint; expectedVersion. Financial amount source is response. See README.

طلب JSON (مثال):

```json
{
  "requestId": "example-partial-payment-0001",
  "expectedVersion": 1,
  "type": "payment",
  "paymentMode": "partial",
  "inputValue": 250,
  "calculationMode": "direct",
  "checkDuplicate": true
}
```

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "LYD",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/customers/{id}/transactions/{transactionId}/corrections

تصحيح حركة. الصلاحية: `debts.write`.

Updates the existing posted transaction in current implementation and records audit; do not assume a new ledger row or new sequence.

طلب JSON (مثال):

```json
{
  "requestId": "example-correction-0001",
  "expectedVersion": 2,
  "type": "debt",
  "inputValue": 300,
  "calculationMode": "direct"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "LYD",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/customers/{id}/transactions/{transactionId}/cancel

إلغاء أثر حركة. الصلاحية: `debts.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-cancel-0001",
  "expectedVersion": 2,
  "reason": "تصحيح تجريبي"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transactionId": "<id>",
    "status": "reversed",
    "customerVersion": 3,
    "balanceUnits": 1000
  }
}
```

## GET /api/companies

قائمة الحسابات وإجمالي القسم. الصلاحية: `companies.read`.

summary is global to section; totalItems is filtered. Do not sum loaded cards to obtain totals.

المعاملات: `q` (Normalized name/phone search; most filters are bypassed when search is nonempty.)، `filter` ({"type":"string","enum":["all","smart","today","due","settled","pinned","pending-review"]})، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200})، `cursor` (Opaque nextCursor from previous response.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
        "name": "شركة المطابقة",
        "phone": null,
        "version": 1,
        "activeCycleId": "9c85602e-f3d9-42e1-babe-968b729c4c92",
        "openingBalanceUnits": 0,
        "balanceUnits": 2000,
        "currency": "LYD",
        "isPinned": false,
        "inactiveSince": null,
        "hiddenFromDefault": false,
        "debtStartedAt": "2026-10-22T22:33:25.125Z",
        "debtAgeDays": 0,
        "activeAssigneeName": null,
        "systemManaged": false,
        "systemLinkKey": null,
        "nextSequence": 2,
        "createdAt": "2026-10-22T22:33:25.125Z",
        "updatedAt": "2026-10-22T22:33:25.125Z"
      }
    ],
    "nextCursor": null,
    "totalItems": 1,
    "summary": {
      "netBalance": 2000,
      "totalDebt": 2000,
      "activeCards": 1,
      "pendingReviewCount": 0
    }
  }
}
```

## POST /api/companies

إنشاء حساب دائم. الصلاحية: `companies.write`.

Replay returns same response with meta.replayed:true. Duplicate identity rejected; see domain error catalog.

طلب JSON (مثال):

```json
{
  "name": "حساب اختبار جديد",
  "openingBalance": 1000,
  "requestId": "example-new-account-0001"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
      "name": "شركة المطابقة",
      "phone": null,
      "version": 1,
      "activeCycleId": "9c85602e-f3d9-42e1-babe-968b729c4c92",
      "openingBalanceUnits": 0,
      "balanceUnits": 2000,
      "currency": "LYD",
      "isPinned": false,
      "inactiveSince": null,
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.125Z",
      "debtAgeDays": 0,
      "activeAssigneeName": null,
      "systemManaged": false,
      "systemLinkKey": null,
      "nextSequence": 2,
      "createdAt": "2026-10-22T22:33:25.125Z",
      "updatedAt": "2026-10-22T22:33:25.125Z"
    }
  }
}
```

## GET /api/companies/suggestions

اقتراحات حسابات موجودة. الصلاحية: `companies.read`.



المعاملات: `q` (At least 2 characters; up to 8 results.).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
        "name": "شركة المطابقة",
        "phone": null,
        "balanceUnits": 2000,
        "currency": "LYD"
      }
    ]
  }
}
```

## GET /api/companies/{id}

تفاصيل الحساب. الصلاحية: `companies.read`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
    "name": "شركة المطابقة",
    "phone": null,
    "version": 1,
    "activeCycleId": "9c85602e-f3d9-42e1-babe-968b729c4c92",
    "openingBalanceUnits": 0,
    "balanceUnits": 2000,
    "currency": "LYD",
    "isPinned": false,
    "inactiveSince": null,
    "hiddenFromDefault": false,
    "debtStartedAt": "2026-10-22T22:33:25.125Z",
    "debtAgeDays": 0,
    "activeAssigneeName": null,
    "systemManaged": false,
    "systemLinkKey": null,
    "nextSequence": 2,
    "createdAt": "2026-10-22T22:33:25.125Z",
    "updatedAt": "2026-10-22T22:33:25.125Z"
  }
}
```

## PATCH /api/companies/{id}

تعديل هوية الحساب. الصلاحية: `companies.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "name": "اسم معدل للاختبار"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
    "name": "اسم معدل للاختبار",
    "phone": null,
    "customerVersion": 2
  }
}
```

## GET /api/companies/{id}/ledger

كشف الحساب ورصيد الصفحة الافتتاحي. الصلاحية: `companies.read`.

Use customer.balanceUnits and pageOpeningBalanceUnits, ignoring reversed rows in running balance. nextCursor is supplied as before.

المعاملات: `before` (Pass nextCursor as before, not as cursor.)، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200}).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
      "name": "شركة المطابقة",
      "phone": null,
      "version": 1,
      "openingBalanceUnits": 0,
      "balanceUnits": 2000,
      "currency": "LYD",
      "isPinned": false,
      "inactiveSince": null,
      "nextSequence": 2,
      "activeCycleId": "9c85602e-f3d9-42e1-babe-968b729c4c92",
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.125Z",
      "debtAgeDays": 0,
      "activeAssigneeName": null,
      "systemManaged": false,
      "systemLinkKey": null,
      "createdAt": "2026-10-22T22:33:25.125Z",
      "updatedAt": "2026-10-22T22:33:25.125Z"
    },
    "pageOpeningBalanceUnits": 0,
    "totalItems": 1,
    "items": [
      {
        "id": "bccb4ebf-899c-4170-8df3-f742edaebc4b",
        "type": "debt",
        "amountUnits": 1000,
        "currency": "LYD",
        "paymentMode": null,
        "calculationMode": "direct",
        "inputValue": 1000,
        "factorMicros": null,
        "transactionDate": "2026-10-22T22:33:24.984Z",
        "referenceNo": "CUST-00000001",
        "note": "رصيد افتتاحي",
        "displayNote": "رصيد افتتاحي",
        "actorName": "مدير الاختبار",
        "actorIsOwner": true,
        "sequence": 1,
        "status": "posted",
        "correctsTransactionId": null,
        "createdAt": "2026-10-22T22:33:24.984Z",
        "updatedAt": "2026-10-22T22:33:24.984Z"
      }
    ],
    "nextCursor": null
  }
}
```

## PATCH /api/companies/{id}/pin

تثبيت الكارت. الصلاحية: `companies.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "isPinned": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
    "isPinned": true,
    "customerVersion": 2
  }
}
```

## POST /api/companies/{id}/transactions

دين أو دفعة جزئية أو كلية. الصلاحية: `companies.write`.

Signed balances allowed; partial overpayment is NOT rejected. full uses current positive balance after validating inputValue. requestId+payload fingerprint; expectedVersion. Financial amount source is response. See README.

طلب JSON (مثال):

```json
{
  "requestId": "example-partial-payment-0001",
  "expectedVersion": 1,
  "type": "payment",
  "paymentMode": "partial",
  "inputValue": 250,
  "calculationMode": "direct",
  "checkDuplicate": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "LYD",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/companies/{id}/transactions/{transactionId}/corrections

تصحيح حركة. الصلاحية: `companies.write`.

Updates the existing posted transaction in current implementation and records audit; do not assume a new ledger row or new sequence.

طلب JSON (مثال):

```json
{
  "requestId": "example-correction-0001",
  "expectedVersion": 2,
  "type": "debt",
  "inputValue": 300,
  "calculationMode": "direct"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "LYD",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/companies/{id}/transactions/{transactionId}/cancel

إلغاء أثر حركة. الصلاحية: `companies.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-cancel-0001",
  "expectedVersion": 2,
  "reason": "تصحيح تجريبي"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transactionId": "<id>",
    "status": "reversed",
    "customerVersion": 3,
    "balanceUnits": 1000
  }
}
```

## GET /api/libyan-deposits

قائمة الحسابات وإجمالي القسم. الصلاحية: `libyan_deposits.read`.

summary is global to section; totalItems is filtered. Do not sum loaded cards to obtain totals.

المعاملات: `q` (Normalized name/phone search; most filters are bypassed when search is nonempty.)، `filter` ({"type":"string","enum":["all","smart","today","due","settled","pinned","pending-review"]})، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200})، `cursor` (Opaque nextCursor from previous response.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "f9190077-ed2b-4cdb-a937-deba81f17085",
        "name": "أمانة ليبية اختبار",
        "phone": null,
        "version": 1,
        "activeCycleId": "dbcc8541-42eb-4cb1-b865-863e608a8da5",
        "openingBalanceUnits": 0,
        "balanceUnits": 300,
        "currency": "LYD",
        "isPinned": false,
        "inactiveSince": null,
        "hiddenFromDefault": false,
        "debtStartedAt": "2026-10-22T22:33:25.181Z",
        "debtAgeDays": 0,
        "activeAssigneeName": null,
        "systemManaged": false,
        "systemLinkKey": null,
        "nextSequence": 2,
        "createdAt": "2026-10-22T22:33:25.181Z",
        "updatedAt": "2026-10-22T22:33:25.181Z"
      }
    ],
    "nextCursor": null,
    "totalItems": 1,
    "summary": {
      "netBalance": 300,
      "totalDebt": 300,
      "activeCards": 1,
      "pendingReviewCount": 0
    }
  }
}
```

## POST /api/libyan-deposits

إنشاء حساب دائم. الصلاحية: `libyan_deposits.write`.

Replay returns same response with meta.replayed:true. Duplicate identity rejected; see domain error catalog.

طلب JSON (مثال):

```json
{
  "name": "حساب اختبار جديد",
  "openingBalance": 1000,
  "requestId": "example-new-account-0001"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "f9190077-ed2b-4cdb-a937-deba81f17085",
      "name": "أمانة ليبية اختبار",
      "phone": null,
      "version": 1,
      "activeCycleId": "dbcc8541-42eb-4cb1-b865-863e608a8da5",
      "openingBalanceUnits": 0,
      "balanceUnits": 300,
      "currency": "LYD",
      "isPinned": false,
      "inactiveSince": null,
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.181Z",
      "debtAgeDays": 0,
      "activeAssigneeName": null,
      "systemManaged": false,
      "systemLinkKey": null,
      "nextSequence": 2,
      "createdAt": "2026-10-22T22:33:25.181Z",
      "updatedAt": "2026-10-22T22:33:25.181Z"
    }
  }
}
```

## GET /api/libyan-deposits/suggestions

اقتراحات حسابات موجودة. الصلاحية: `libyan_deposits.read`.



المعاملات: `q` (At least 2 characters; up to 8 results.).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "f9190077-ed2b-4cdb-a937-deba81f17085",
        "name": "أمانة ليبية اختبار",
        "phone": null,
        "balanceUnits": 300,
        "currency": "LYD"
      }
    ]
  }
}
```

## GET /api/libyan-deposits/{id}

تفاصيل الحساب. الصلاحية: `libyan_deposits.read`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "f9190077-ed2b-4cdb-a937-deba81f17085",
    "name": "أمانة ليبية اختبار",
    "phone": null,
    "version": 1,
    "activeCycleId": "dbcc8541-42eb-4cb1-b865-863e608a8da5",
    "openingBalanceUnits": 0,
    "balanceUnits": 300,
    "currency": "LYD",
    "isPinned": false,
    "inactiveSince": null,
    "hiddenFromDefault": false,
    "debtStartedAt": "2026-10-22T22:33:25.181Z",
    "debtAgeDays": 0,
    "activeAssigneeName": null,
    "systemManaged": false,
    "systemLinkKey": null,
    "nextSequence": 2,
    "createdAt": "2026-10-22T22:33:25.181Z",
    "updatedAt": "2026-10-22T22:33:25.181Z"
  }
}
```

## PATCH /api/libyan-deposits/{id}

تعديل هوية الحساب. الصلاحية: `libyan_deposits.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "name": "اسم معدل للاختبار"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "f9190077-ed2b-4cdb-a937-deba81f17085",
    "name": "اسم معدل للاختبار",
    "phone": null,
    "customerVersion": 2
  }
}
```

## GET /api/libyan-deposits/{id}/ledger

كشف الحساب ورصيد الصفحة الافتتاحي. الصلاحية: `libyan_deposits.read`.

Use customer.balanceUnits and pageOpeningBalanceUnits, ignoring reversed rows in running balance. nextCursor is supplied as before.

المعاملات: `before` (Pass nextCursor as before, not as cursor.)، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200}).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "f9190077-ed2b-4cdb-a937-deba81f17085",
      "name": "أمانة ليبية اختبار",
      "phone": null,
      "version": 1,
      "openingBalanceUnits": 0,
      "balanceUnits": 300,
      "currency": "LYD",
      "isPinned": false,
      "inactiveSince": null,
      "nextSequence": 2,
      "activeCycleId": "dbcc8541-42eb-4cb1-b865-863e608a8da5",
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.181Z",
      "debtAgeDays": 0,
      "activeAssigneeName": null,
      "systemManaged": false,
      "systemLinkKey": null,
      "createdAt": "2026-10-22T22:33:25.181Z",
      "updatedAt": "2026-10-22T22:33:25.181Z"
    },
    "pageOpeningBalanceUnits": 0,
    "totalItems": 1,
    "items": [
      {
        "id": "bccb4ebf-899c-4170-8df3-f742edaebc4b",
        "type": "debt",
        "amountUnits": 1000,
        "currency": "LYD",
        "paymentMode": null,
        "calculationMode": "direct",
        "inputValue": 1000,
        "factorMicros": null,
        "transactionDate": "2026-10-22T22:33:24.984Z",
        "referenceNo": "CUST-00000001",
        "note": "رصيد افتتاحي",
        "displayNote": "رصيد افتتاحي",
        "actorName": "مدير الاختبار",
        "actorIsOwner": true,
        "sequence": 1,
        "status": "posted",
        "correctsTransactionId": null,
        "createdAt": "2026-10-22T22:33:24.984Z",
        "updatedAt": "2026-10-22T22:33:24.984Z"
      }
    ],
    "nextCursor": null
  }
}
```

## PATCH /api/libyan-deposits/{id}/pin

تثبيت الكارت. الصلاحية: `libyan_deposits.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "isPinned": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "f9190077-ed2b-4cdb-a937-deba81f17085",
    "isPinned": true,
    "customerVersion": 2
  }
}
```

## POST /api/libyan-deposits/{id}/transactions

دين أو دفعة جزئية أو كلية. الصلاحية: `libyan_deposits.write`.

Signed balances allowed; partial overpayment is NOT rejected. full uses current positive balance after validating inputValue. requestId+payload fingerprint; expectedVersion. Financial amount source is response. See README.

طلب JSON (مثال):

```json
{
  "requestId": "example-partial-payment-0001",
  "expectedVersion": 1,
  "type": "payment",
  "paymentMode": "partial",
  "inputValue": 250,
  "calculationMode": "direct",
  "checkDuplicate": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "LYD",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/libyan-deposits/{id}/transactions/{transactionId}/corrections

تصحيح حركة. الصلاحية: `libyan_deposits.write`.

Updates the existing posted transaction in current implementation and records audit; do not assume a new ledger row or new sequence.

طلب JSON (مثال):

```json
{
  "requestId": "example-correction-0001",
  "expectedVersion": 2,
  "type": "debt",
  "inputValue": 300,
  "calculationMode": "direct"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "LYD",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/libyan-deposits/{id}/transactions/{transactionId}/cancel

إلغاء أثر حركة. الصلاحية: `libyan_deposits.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-cancel-0001",
  "expectedVersion": 2,
  "reason": "تصحيح تجريبي"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transactionId": "<id>",
    "status": "reversed",
    "customerVersion": 3,
    "balanceUnits": 1000
  }
}
```

## GET /api/egyptian-deposits

قائمة الحسابات وإجمالي القسم. الصلاحية: `egyptian_deposits.read`.

summary is global to section; totalItems is filtered. Do not sum loaded cards to obtain totals.

المعاملات: `q` (Normalized name/phone search; most filters are bypassed when search is nonempty.)، `filter` ({"type":"string","enum":["all","smart","today","due","settled","pinned","pending-review"]})، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200})، `cursor` (Opaque nextCursor from previous response.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "system-egp-vodafone:org-default",
        "name": "فودافون قسم المشتريات",
        "phone": null,
        "version": 3,
        "activeCycleId": "system-egp-vodafone-cycle:org-default",
        "openingBalanceUnits": 0,
        "balanceUnits": 4900,
        "currency": "EGP",
        "isPinned": true,
        "inactiveSince": null,
        "hiddenFromDefault": false,
        "debtStartedAt": null,
        "debtAgeDays": null,
        "activeAssigneeName": null,
        "systemManaged": true,
        "systemLinkKey": "purchases_vodafone_remainder",
        "nextSequence": 1,
        "createdAt": "2026-10-22 22:33:23",
        "updatedAt": "2026-10-22T22:33:25.399Z"
      },
      {
        "id": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
        "name": "أمانة مصرية اختبار",
        "phone": null,
        "version": 1,
        "activeCycleId": "eebcb0ac-06a8-43db-96b1-435d166100f6",
        "openingBalanceUnits": 0,
        "balanceUnits": 10000,
        "currency": "EGP",
        "isPinned": false,
        "inactiveSince": null,
        "hiddenFromDefault": false,
        "debtStartedAt": "2026-10-22T22:33:25.214Z",
        "debtAgeDays": 0,
        "activeAssigneeName": null,
        "systemManaged": false,
        "systemLinkKey": null,
        "nextSequence": 2,
        "createdAt": "2026-10-22T22:33:25.214Z",
        "updatedAt": "2026-10-22T22:33:25.214Z"
      },
      {
        "id": "system-egp-masraweya:org-default",
        "name": "قسم المصراوية",
        "phone": null,
        "version": 1,
        "activeCycleId": "system-egp-masraweya-cycle:org-default",
        "openingBalanceUnits": 0,
        "balanceUnits": 0,
        "currency": "EGP",
        "isPinned": true,
        "inactiveSince": "2026-10-22 22:33:23",
        "hiddenFromDefault": false,
        "debtStartedAt": null,
        "debtAgeDays": null,
        "activeAssigneeName": null,
        "systemManaged": true,
        "systemLinkKey": "masraweya_remainder",
        "nextSequence": 1,
        "createdAt": "2026-10-22 22:33:23",
        "updatedAt": "2026-10-22 22:33:23"
      }
    ],
    "nextCursor": null,
    "totalItems": 3,
    "summary": {
      "netBalance": 14900,
      "totalDebt": 14900,
      "activeCards": 2,
      "pendingReviewCount": 0
    }
  }
}
```

## POST /api/egyptian-deposits

إنشاء حساب دائم. الصلاحية: `egyptian_deposits.write`.

Replay returns same response with meta.replayed:true. Duplicate identity rejected; see domain error catalog.

طلب JSON (مثال):

```json
{
  "name": "حساب اختبار جديد",
  "openingBalance": 1000,
  "requestId": "example-new-account-0001"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
      "name": "أمانة مصرية اختبار",
      "phone": null,
      "version": 1,
      "activeCycleId": "eebcb0ac-06a8-43db-96b1-435d166100f6",
      "openingBalanceUnits": 0,
      "balanceUnits": 10000,
      "currency": "EGP",
      "isPinned": false,
      "inactiveSince": null,
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.214Z",
      "debtAgeDays": 0,
      "activeAssigneeName": null,
      "systemManaged": false,
      "systemLinkKey": null,
      "nextSequence": 2,
      "createdAt": "2026-10-22T22:33:25.214Z",
      "updatedAt": "2026-10-22T22:33:25.214Z"
    }
  }
}
```

## GET /api/egyptian-deposits/suggestions

اقتراحات حسابات موجودة. الصلاحية: `egyptian_deposits.read`.



المعاملات: `q` (At least 2 characters; up to 8 results.).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
        "name": "أمانة مصرية اختبار",
        "phone": null,
        "balanceUnits": 10000,
        "currency": "EGP"
      }
    ]
  }
}
```

## GET /api/egyptian-deposits/{id}

تفاصيل الحساب. الصلاحية: `egyptian_deposits.read`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
    "name": "أمانة مصرية اختبار",
    "phone": null,
    "version": 1,
    "activeCycleId": "eebcb0ac-06a8-43db-96b1-435d166100f6",
    "openingBalanceUnits": 0,
    "balanceUnits": 10000,
    "currency": "EGP",
    "isPinned": false,
    "inactiveSince": null,
    "hiddenFromDefault": false,
    "debtStartedAt": "2026-10-22T22:33:25.214Z",
    "debtAgeDays": 0,
    "activeAssigneeName": null,
    "systemManaged": false,
    "systemLinkKey": null,
    "nextSequence": 2,
    "createdAt": "2026-10-22T22:33:25.214Z",
    "updatedAt": "2026-10-22T22:33:25.214Z"
  }
}
```

## PATCH /api/egyptian-deposits/{id}

تعديل هوية الحساب. الصلاحية: `egyptian_deposits.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "name": "اسم معدل للاختبار"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
    "name": "اسم معدل للاختبار",
    "phone": null,
    "customerVersion": 2
  }
}
```

## GET /api/egyptian-deposits/{id}/ledger

كشف الحساب ورصيد الصفحة الافتتاحي. الصلاحية: `egyptian_deposits.read`.

Use customer.balanceUnits and pageOpeningBalanceUnits, ignoring reversed rows in running balance. nextCursor is supplied as before.

المعاملات: `before` (Pass nextCursor as before, not as cursor.)، `limit` ({"type":"integer","default":100,"minimum":20,"maximum":200}).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customer": {
      "id": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
      "name": "أمانة مصرية اختبار",
      "phone": null,
      "version": 1,
      "openingBalanceUnits": 0,
      "balanceUnits": 10000,
      "currency": "EGP",
      "isPinned": false,
      "inactiveSince": null,
      "nextSequence": 2,
      "activeCycleId": "eebcb0ac-06a8-43db-96b1-435d166100f6",
      "hiddenFromDefault": false,
      "debtStartedAt": "2026-10-22T22:33:25.214Z",
      "debtAgeDays": 0,
      "activeAssigneeName": null,
      "systemManaged": false,
      "systemLinkKey": null,
      "createdAt": "2026-10-22T22:33:25.214Z",
      "updatedAt": "2026-10-22T22:33:25.214Z"
    },
    "pageOpeningBalanceUnits": 0,
    "totalItems": 1,
    "items": [
      {
        "id": "bccb4ebf-899c-4170-8df3-f742edaebc4b",
        "type": "debt",
        "amountUnits": 1000,
        "currency": "LYD",
        "paymentMode": null,
        "calculationMode": "direct",
        "inputValue": 1000,
        "factorMicros": null,
        "transactionDate": "2026-10-22T22:33:24.984Z",
        "referenceNo": "CUST-00000001",
        "note": "رصيد افتتاحي",
        "displayNote": "رصيد افتتاحي",
        "actorName": "مدير الاختبار",
        "actorIsOwner": true,
        "sequence": 1,
        "status": "posted",
        "correctsTransactionId": null,
        "createdAt": "2026-10-22T22:33:24.984Z",
        "updatedAt": "2026-10-22T22:33:24.984Z"
      }
    ],
    "nextCursor": null
  }
}
```

## PATCH /api/egyptian-deposits/{id}/pin

تثبيت الكارت. الصلاحية: `egyptian_deposits.write`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "isPinned": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "customerId": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
    "isPinned": true,
    "customerVersion": 2
  }
}
```

## POST /api/egyptian-deposits/{id}/transactions

دين أو دفعة جزئية أو كلية. الصلاحية: `egyptian_deposits.write`.

Signed balances allowed; partial overpayment is NOT rejected. full uses current positive balance after validating inputValue. requestId+payload fingerprint; expectedVersion. Financial amount source is response. See README.

طلب JSON (مثال):

```json
{
  "requestId": "example-partial-payment-0001",
  "expectedVersion": 1,
  "type": "payment",
  "paymentMode": "partial",
  "inputValue": 250,
  "calculationMode": "direct",
  "checkDuplicate": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "EGP",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/egyptian-deposits/{id}/transactions/{transactionId}/corrections

تصحيح حركة. الصلاحية: `egyptian_deposits.write`.

Updates the existing posted transaction in current implementation and records audit; do not assume a new ledger row or new sequence.

طلب JSON (مثال):

```json
{
  "requestId": "example-correction-0001",
  "expectedVersion": 2,
  "type": "debt",
  "inputValue": 300,
  "calculationMode": "direct"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transaction": {
      "id": "8cde1288-d1da-483e-907c-444b0357d4f3",
      "type": "payment",
      "amountUnits": 250,
      "currency": "EGP",
      "paymentMode": "partial",
      "calculationMode": "direct",
      "inputValue": 250,
      "factorMicros": null,
      "transactionDate": "2026-10-22T22:33:49.630Z",
      "referenceNo": "CUST-00000005",
      "note": "مطابقة Android مصطنعة",
      "actorName": "مدير الاختبار",
      "sequence": 2,
      "status": "posted",
      "correctsTransactionId": null,
      "createdAt": "2026-10-22T22:33:49.631Z"
    },
    "customerVersion": 2,
    "balanceUnits": 750
  },
  "meta": {
    "replayed": false
  }
}
```

## POST /api/egyptian-deposits/{id}/transactions/{transactionId}/cancel

إلغاء أثر حركة. الصلاحية: `egyptian_deposits.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-cancel-0001",
  "expectedVersion": 2,
  "reason": "تصحيح تجريبي"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "transactionId": "<id>",
    "status": "reversed",
    "customerVersion": 3,
    "balanceUnits": 1000
  }
}
```

## POST /api/customers/{id}/zero-review

مراجعة الكارت الصفري. الصلاحية: `admin`.



طلب JSON (مثال):

```json
{
  "expectedFinancialVersion": 3
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "zeroReview": {
      "pending": false,
      "financialVersion": 3,
      "reviewedAt": "2026-10-22T22:00:00.000Z",
      "reviewedByName": "مدير الاختبار"
    }
  }
}
```

## GET /api/egyptian-deposits/exchange-rate

سعر الأمانات المصرية. الصلاحية: `egyptian_deposits.read`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "sourceCurrency": "EGP",
    "targetCurrency": "LYD",
    "egpPerLyd": 10,
    "updatedAt": "2026-10-22T22:33:25.306Z",
    "activeForTreasury": true
  }
}
```

## PATCH /api/egyptian-deposits/exchange-rate

اعتماد سعر التحويل. الصلاحية: `egyptian_deposits.write`.



طلب JSON (مثال):

```json
{
  "egpPerLyd": 10
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "sourceCurrency": "EGP",
    "targetCurrency": "LYD",
    "egpPerLyd": 10,
    "updatedAt": "2026-10-22T22:33:25.306Z",
    "activeForTreasury": true
  }
}
```

## GET /api/collections

الاستلامات والمعلقة والمقاييس. الصلاحية: `collections.read`.

Admin sees organization; employee only assigned/owned records. No pagination; metrics include approved sums and separate pending counts. No financial effect for pending.

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "assignments": [
      {
        "id": "25b85f67-5977-40b6-b891-e278e59817b8",
        "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
        "assigneeUserId": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "status": "active",
        "businessDate": "2026-10-23",
        "batchId": "75a8a1c0-0c23-4d5a-8598-4c9d8c6dd869",
        "assignedAt": "2026-10-22T22:33:25.497Z",
        "customerName": "عميل تحصيل الاختبار",
        "phone": null,
        "customerVersion": 2,
        "assigneeName": "محصل الاختبار",
        "balanceUnits": 300,
        "hasPending": 1,
        "latestMode": "partial",
        "latestStatus": "pending",
        "latestCashReceivedAt": null,
        "latestDecisionAt": null,
        "externalFinancialUpdatedAt": "2026-10-22T22:33:25.497Z",
        "latestSubmissionAt": "2026-10-22T22:33:25.715Z",
        "cashOutstandingCount": 1
      }
    ],
    "submissions": [
      {
        "id": "d37f68dd-814d-4a9b-908b-278e1a259b2f",
        "assignmentId": "25b85f67-5977-40b6-b891-e278e59817b8",
        "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
        "collectorUserId": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "mode": "partial",
        "amountUnits": 50,
        "status": "pending",
        "businessDate": "2026-10-23",
        "batchId": "75a8a1c0-0c23-4d5a-8598-4c9d8c6dd869",
        "submittedAt": "2026-10-22T22:33:25.715Z",
        "decidedAt": null,
        "decisionNote": "",
        "cashReceivedAt": null,
        "customerName": "عميل تحصيل الاختبار",
        "phone": null,
        "collectorName": "محصل الاختبار"
      },
      {
        "id": "ec6a801b-377e-4fb5-9aca-aa8efdb252ea",
        "assignmentId": "25b85f67-5977-40b6-b891-e278e59817b8",
        "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
        "collectorUserId": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "mode": "partial",
        "amountUnits": 100,
        "status": "approved",
        "businessDate": "2026-10-23",
        "batchId": "75a8a1c0-0c23-4d5a-8598-4c9d8c6dd869",
        "submittedAt": "2026-10-22T22:33:25.523Z",
        "decidedAt": "2026-10-22T22:33:25.560Z",
        "decisionNote": "",
        "cashReceivedAt": null,
        "customerName": "عميل تحصيل الاختبار",
        "phone": null,
        "collectorName": "محصل الاختبار"
      }
    ],
    "unlinkedReceipts": [
      {
        "id": "ef293fb5-7a04-4e24-8624-3e02fd9c8115",
        "customerName": "استلام مستقل للاختبار",
        "amountUnits": 75,
        "status": "pending",
        "submittedAt": "2026-10-22T22:33:25.792Z",
        "businessDate": "2026-10-23",
        "batchId": "75a8a1c0-0c23-4d5a-8598-4c9d8c6dd869",
        "linkedCustomerId": null,
        "entryType": null,
        "decidedAt": null,
        "decisionNote": "",
        "cashReceivedAt": null,
        "collectorName": "محصل الاختبار"
      }
    ],
    "outstandingCancelledSubmissions": [],
    "metrics": {
      "collectedUnits": 100,
      "pendingCount": 1,
      "executedCount": 1,
      "cashOutstandingUnits": 100,
      "unlinkedPendingCount": 1
    },
    "employeeTotals": [
      {
        "employeeId": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "employeeName": "محصل الاختبار",
        "collectedUnits": 100,
        "approvedCount": 1,
        "pendingCount": 2
      },
      {
        "employeeId": "b6885015-cb21-4636-a115-d511074485c8",
        "employeeName": "مشرف اختبار محدود",
        "collectedUnits": 0,
        "approvedCount": 0,
        "pendingCount": 0
      }
    ],
    "assignedCount": 1,
    "openBatches": [
      {
        "id": "75a8a1c0-0c23-4d5a-8598-4c9d8c6dd869",
        "businessDate": "2026-10-23",
        "batchNumber": 1,
        "openedAt": "2026-10-22T22:33:25.497Z"
      }
    ]
  }
}
```

## GET /api/collections/assignees

الموظفون المتاحون للتوجيه. الصلاحية: `admin`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "username": "android-collector",
        "displayName": "محصل الاختبار"
      }
    ]
  }
}
```

## POST /api/collections/assignments

توجيه الكروت. الصلاحية: `admin`.

No client requestId or expectedVersion. Active assignment uniqueness; positive debt required.

طلب JSON (مثال):

```json
{
  "customerIds": [
    "<customer-id>"
  ],
  "assigneeUserId": "<collector-id>",
  "section": "customers"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "assignmentIds": [
      "<assignment-id>"
    ],
    "eventSequences": [
      1
    ]
  }
}
```

## POST /api/collections/assignments/{assignmentId}/submissions

تقديم تحصيل مرتبط. الصلاحية: `collections.write + own assignment (or admin)`.

NO requestId/expectedVersion support here. Partial requires amountUnits; full amount optional but if supplied must equal current debt. Do not auto-retry after uncertain success.

طلب JSON (مثال):

```json
{
  "mode": "partial",
  "amountUnits": 250,
  "checkDuplicate": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<submission-id>",
    "status": "pending",
    "amountUnits": 250,
    "eventSequences": [
      2
    ]
  }
}
```

## POST /api/collections/submissions/{id}/decision

قبول أو رفض التحصيل. الصلاحية: `admin`.

Only pending may be decided. Rejection returns id/status/events, no transactionId/balanceUnits. Unlinked requires linking/new account and entryType for approve.

طلب JSON (مثال):

```json
{
  "decision": "approve",
  "note": "مطابقة اختبار"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "status": "approved",
    "transactionId": "<transaction-id>",
    "balanceUnits": 750,
    "eventSequences": [
      3
    ]
  }
}
```

## POST /api/collections/submissions/{id}/cash-received

استلام النقدية المعتمدة. الصلاحية: `admin`.

Approved only. Replays return cashReceivedAt and replayed:true; no automatic active-cash entry.

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "cashReceivedAt": "2026-10-22T22:00:00.000Z",
    "eventSequences": [
      4
    ]
  }
}
```

## POST /api/collections/unlinked-receipts/{id}/decision

قبول أو رفض التحصيل. الصلاحية: `admin`.

Only pending may be decided. Rejection returns id/status/events, no transactionId/balanceUnits. Unlinked requires linking/new account and entryType for approve.

طلب JSON (مثال):

```json
{
  "decision": "approve",
  "note": "مطابقة اختبار",
  "customerId": "<existing-customer>",
  "entryType": "payment"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "status": "approved",
    "transactionId": "<transaction-id>",
    "balanceUnits": 750,
    "eventSequences": [
      3
    ]
  }
}
```

## POST /api/collections/unlinked-receipts/{id}/cash-received

استلام النقدية المعتمدة. الصلاحية: `admin`.

Approved only. Replays return cashReceivedAt and replayed:true; no automatic active-cash entry.

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "cashReceivedAt": "2026-10-22T22:00:00.000Z",
    "eventSequences": [
      4
    ]
  }
}
```

## POST /api/collections/unlinked-receipts

إرسال استلام غير مربوط. الصلاحية: `employee + collections.write (admin forbidden)`.

requestId replay has no payload fingerprint; persist key with immutable payload. Admin cannot create employee receipts.

طلب JSON (مثال):

```json
{
  "customerName": "عميل غير مربوط تجريبي",
  "amountUnits": 75,
  "requestId": "example-unlinked-0001"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "status": "pending",
    "amountUnits": 75,
    "eventSequences": [
      5
    ]
  }
}
```

## GET /api/collections/link-candidates

مرشحو ربط الاستلام. الصلاحية: `admin`.

Candidates may include Egyptian-deposit accounts; do not assume currency conversion on linking.

المعاملات: `q` (At least 2 characters).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "<id>",
        "name": "عميل المطابقة ألف",
        "balanceUnits": 1000,
        "sectionKey": "customer_debts"
      }
    ]
  }
}
```

## POST /api/collections/days/close

إغلاق دفعة التحصيل. الصلاحية: `admin`.

Requires all pending reviewed and cash received. Deletes batch working rows; financial ledger remains. Do not expose as a routine refresh.

طلب JSON (مثال):

```json
{
  "batchId": "<batch-id>",
  "confirmed": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "batchId": "<batch-id>",
    "businessDate": "2026-10-23",
    "closed": true,
    "deletedAssignments": 1,
    "deletedSubmissions": 2,
    "deletedUnlinkedReceipts": 1,
    "closedAt": "2026-10-22T22:00:00.000Z",
    "eventSequences": [
      6
    ]
  }
}
```

## GET /api/collections/payroll

رواتب وسحوبات وعمولات. الصلاحية: `collections.read`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "period": "2026-10",
    "employees": [
      {
        "employeeId": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "employeeName": "محصل الاختبار",
        "username": "android-collector",
        "period": "2026-10",
        "baseSalaryUnits": 3500,
        "openingCarryUnits": 0,
        "showOpeningCarry": false,
        "withdrawalsUnits": 0,
        "commissionsUnits": 0,
        "remainingUnits": 3500,
        "entries": []
      },
      {
        "employeeId": "b6885015-cb21-4636-a115-d511074485c8",
        "employeeName": "مشرف اختبار محدود",
        "username": "android-limited",
        "period": "2026-10",
        "baseSalaryUnits": 3500,
        "openingCarryUnits": 0,
        "showOpeningCarry": false,
        "withdrawalsUnits": 0,
        "commissionsUnits": 0,
        "remainingUnits": 3500,
        "entries": []
      }
    ]
  }
}
```

## POST /api/collections/payroll/entries

سحب أو عمولة موظف. الصلاحية: `admin`.



طلب JSON (مثال):

```json
{
  "employeeUserId": "<collector-id>",
  "kind": "withdrawal",
  "amountUnits": 50,
  "reason": "اختبار",
  "requestId": "example-payroll-0001"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "eventSequences": [
      7
    ]
  }
}
```

## PUT /api/collections/payroll/employees/{id}/salary

ضبط المرتب الأساسي. الصلاحية: `admin`.



طلب JSON (مثال):

```json
{
  "baseSalaryUnits": 1000
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "employeeId": "<id>",
    "baseSalaryUnits": 1000,
    "eventSequences": [
      8
    ]
  }
}
```

## POST /api/collections/payroll/entries/{id}/confirm

تأكيد الموظف على بند راتبه. الصلاحية: `collections.read + entry owner`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": "<id>",
    "confirmedAt": "2026-10-22T22:00:00.000Z",
    "eventSequences": [
      9
    ]
  }
}
```

## GET /api/purchases/{merchant}

دفتر التاجر وإجماليات كل المدة. الصلاحية: `purchases.read`.

registerTotals are across all nondeleted merchant entries; remaining fields use current carried balance. Mixed EGP/LYD fields; see README.

المعاملات: `before` (Pass the previous nextBefore.)، `limit` ({"type":"integer","minimum":20,"maximum":200,"default":100}).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "merchant": {
      "key": "al_bayan",
      "name": "البيان"
    },
    "day": {
      "id": "9b294ca8-fc62-459e-ba56-5312e94681a9",
      "dayNumber": 1,
      "businessDate": "2026-10-23",
      "status": "draft",
      "previousDebtUnits": 0,
      "previousVodafoneUnits": 5000,
      "todayResultUnits": 100,
      "todayPaidUnits": 20,
      "totalDebtUnits": 80,
      "vodafoneRemainingUnits": 4900,
      "version": 2,
      "correctionOpen": false
    },
    "entries": [
      {
        "id": "d0f6a687-1267-471b-831e-a4568602d82c",
        "dayId": "9b294ca8-fc62-459e-ba56-5312e94681a9",
        "sequence": 1,
        "dayNumber": 1,
        "businessDate": "2026-10-23",
        "dayStatus": "draft",
        "dayClosingDebtUnits": 80,
        "itemCode": "custom",
        "itemLabel": "مشتريات اختبار",
        "egpValueUnits": 1000,
        "calculationMode": "divide",
        "exchangeRate": 10,
        "resultUnits": 100,
        "paidUnits": 20,
        "remainingUnits": 80,
        "vodafoneConsumedUnits": 100,
        "actorName": "مدير الاختبار",
        "actorIsOwner": true,
        "version": 1,
        "dayVersion": 2,
        "correctionOpen": false,
        "createdAt": "2026-10-22T22:33:25.399Z",
        "updatedAt": "2026-10-22T22:33:25.399Z"
      }
    ],
    "nextBefore": null,
    "registerTotals": {
      "resultUnits": 100,
      "paidUnits": 20,
      "remainingUnits": 80,
      "vodafoneConsumedUnits": 100,
      "vodafoneRemainingUnits": 4900
    }
  }
}
```

## POST /api/purchases/{merchant}

إضافة مشتريات. الصلاحية: `purchases.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-purchase-0001",
  "expectedDayVersion": 1,
  "itemCode": "custom",
  "itemLabel": "اختبار",
  "egpValueUnits": 1000,
  "calculationMode": "divide",
  "exchangeRate": "10",
  "paidUnits": 20,
  "vodafoneConsumedUnits": 100
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "entryId": "<id>",
    "sequence": 1,
    "eventSequences": [
      10
    ]
  }
}
```

## PATCH /api/purchases/{merchant}/entries/{id}

تعديل صف مشتريات. الصلاحية: `purchases.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-purchase-0001",
  "expectedDayVersion": 1,
  "itemCode": "custom",
  "itemLabel": "اختبار",
  "egpValueUnits": 1000,
  "calculationMode": "divide",
  "exchangeRate": "10",
  "paidUnits": 20,
  "vodafoneConsumedUnits": 100,
  "expectedVersion": 1
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "entryId": "<id>",
    "eventSequences": [
      11
    ]
  }
}
```

## DELETE /api/purchases/{merchant}/entries/{id}

حذف صف مشتريات. الصلاحية: `purchases.write`.



طلب JSON (مثال):

```json
{
  "requestId": "example-delete-0001",
  "expectedVersion": 1,
  "expectedDayVersion": 2
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "entryId": "<id>",
    "eventSequences": [
      12
    ]
  }
}
```

## PATCH /api/purchases/{merchant}/opening

افتتاحي دفتر المشتريات. الصلاحية: `purchases.write`.

First day before any nondeleted entry only; signed opening values supported.

طلب JSON (مثال):

```json
{
  "expectedDayVersion": 1,
  "previousDebtUnits": 0,
  "previousVodafoneUnits": 5000
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "eventSequences": [
      13
    ]
  }
}
```

## POST /api/purchases/{merchant}/finalize

ترحيل يوم المشتريات. الصلاحية: `purchases.finalize`.

Read GET after success for the newly opened day.

طلب JSON (مثال):

```json
{
  "requestId": "example-finalize-0001",
  "expectedDayVersion": 2
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "finalizedDayId": "<id>",
    "eventSequences": [
      14
    ]
  }
}
```

## PATCH /api/purchases/{merchant}/days/{id}/correction

فتح أو غلق تعديل يوم مرحل. الصلاحية: `purchases.finalize`.



طلب JSON (مثال):

```json
{
  "open": true,
  "expectedVersion": 2
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "dayId": "<id>",
    "correctionOpen": true,
    "eventSequences": [
      15
    ]
  }
}
```

## GET /api/treasury

إجماليات الخزينة. الصلاحية: `treasury.read`.

netUnits may be null if EGP nonzero and rate missing. activeCashUnits is independent of collection approval.

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "currency": "LYD",
    "receivablesUnits": 3550,
    "liabilitiesUnits": 380,
    "activeCashUnits": 500,
    "egyptianSourceUnits": 14900,
    "egyptianConvertedUnits": 1490,
    "egyptianRate": 10,
    "egyptianRateUpdatedAt": "2026-10-22T22:33:25.306Z",
    "netUnits": 5160,
    "cashVersion": 1,
    "sources": {
      "customers": 1550,
      "companies": 2000,
      "purchases": 80,
      "libyanDeposits": 300,
      "egyptianDeposits": 14900
    }
  }
}
```

## GET /api/treasury/cash-ledger

سجل النقدية. الصلاحية: `treasury.read`.



المعاملات: `before` (Pass the previous nextBefore.).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "<id>",
        "sequence": 1,
        "direction": "in",
        "amountUnits": 500,
        "description": "اختبار",
        "balanceBeforeUnits": 0,
        "balanceAfterUnits": 500,
        "actorName": "مدير الاختبار",
        "actorIsOwner": true,
        "createdAt": "2026-10-22T22:00:00.000Z"
      }
    ],
    "nextBefore": null
  }
}
```

## POST /api/treasury/cash-entries

دخول نقدية أو مصروف/خروج. الصلاحية: `treasury.write`.

No standalone /api/expenses resource; expenses are direction=out. Use returned cashVersion for next write.

طلب JSON (مثال):

```json
{
  "requestId": "example-cash-out-0001",
  "expectedVersion": 1,
  "direction": "out",
  "amountUnits": 50,
  "description": "مصروف اختبار"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "entry": {
      "id": "<id>",
      "sequence": 2,
      "direction": "out",
      "amountUnits": 50,
      "description": "مصروف اختبار",
      "balanceBeforeUnits": 500,
      "balanceAfterUnits": 450,
      "actorName": "مدير الاختبار",
      "actorIsOwner": true,
      "createdAt": "2026-10-22T22:00:00.000Z"
    },
    "cashVersion": 2,
    "activeCashUnits": 450
  }
}
```

## GET /api/reports

التقارير الذكية. الصلاحية: `reports.read`.



المعاملات: `limit` ({"type":"integer","default":30,"minimum":1,"maximum":366}).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "current": {
      "sequence": 1,
      "businessDate": "2026-10-23",
      "receivablesUnits": 3550,
      "liabilitiesUnits": 380,
      "activeCashUnits": 500,
      "egyptianSourceUnits": 14900,
      "egyptianConvertedUnits": 1490,
      "egyptianRate": 10,
      "netUnits": 5160,
      "daily": {
        "receivablesAddedUnits": 3650,
        "paymentsUnits": 100,
        "liabilitiesEffectUnits": 380,
        "cashInUnits": 500,
        "cashOutUnits": 0
      },
      "status": "normal",
      "summary": "هذا أول يوم محفوظ في السجل؛ سيظهر الفرق ابتداءً من اليوم التالي.",
      "reasons": [],
      "version": 1,
      "generatedAt": "2026-10-22T22:33:25.958Z",
      "updatedAt": "2026-10-22T22:33:25.958Z",
      "isFinalized": false,
      "finalizedAt": null,
      "fiveAmClosing": {
        "state": "pending",
        "scheduledAt": "2026-10-24T03:00:00.000Z",
        "capturedAt": null,
        "netUnits": null
      }
    },
    "items": [
      {
        "sequence": 1,
        "businessDate": "2026-10-23",
        "receivablesUnits": 3550,
        "liabilitiesUnits": 380,
        "activeCashUnits": 500,
        "egyptianSourceUnits": 14900,
        "egyptianConvertedUnits": 1490,
        "egyptianRate": 10,
        "netUnits": 5160,
        "daily": {
          "receivablesAddedUnits": 3650,
          "paymentsUnits": 100,
          "liabilitiesEffectUnits": 380,
          "cashInUnits": 500,
          "cashOutUnits": 0
        },
        "status": "normal",
        "summary": "هذا أول يوم محفوظ في السجل؛ سيظهر الفرق ابتداءً من اليوم التالي.",
        "reasons": [],
        "version": 1,
        "generatedAt": "2026-10-22T22:33:25.958Z",
        "updatedAt": "2026-10-22T22:33:25.958Z",
        "isFinalized": false,
        "finalizedAt": null,
        "fiveAmClosing": {
          "state": "pending",
          "scheduledAt": "2026-10-24T03:00:00.000Z",
          "capturedAt": null,
          "netUnits": null
        }
      }
    ],
    "methodology": {
      "formula": "الديون لنا + الأموال النشطة + المصري المحول - الديون علينا",
      "note": "التغير المعروض هو تغير المركز المالي وليس ربحًا محاسبيًا معتمدًا.",
      "currency": "LYD"
    }
  }
}
```

## GET /api/notifications

الإشعارات غير المقروءة. الصلاحية: `authenticated`.



المعاملات: `before` (Pass the previous nextBefore.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": 4,
        "action": "collection.unlinked.submit",
        "entityType": "collection_submission",
        "entityId": "ef293fb5-7a04-4e24-8624-3e02fd9c8115",
        "sectionKey": "collections",
        "details": {
          "subjectName": "استلام مستقل للاختبار",
          "subjectSection": "collections",
          "amountUnits": 75
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "actorRole": "employee",
        "createdAt": "2026-10-22T22:33:25.792Z",
        "readAt": null
      },
      {
        "id": 3,
        "action": "collection.submit",
        "entityType": "collection_submission",
        "entityId": "d37f68dd-814d-4a9b-908b-278e1a259b2f",
        "sectionKey": "collections",
        "details": {
          "assignmentId": "25b85f67-5977-40b6-b891-e278e59817b8",
          "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
          "subjectName": "عميل تحصيل الاختبار",
          "subjectSection": "customer_debts",
          "mode": "partial",
          "paymentMode": "partial",
          "amountUnits": 50
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "actorRole": "employee",
        "createdAt": "2026-10-22T22:33:25.715Z",
        "readAt": null
      },
      {
        "id": 2,
        "action": "collection.submit",
        "entityType": "collection_submission",
        "entityId": "ec6a801b-377e-4fb5-9aca-aa8efdb252ea",
        "sectionKey": "collections",
        "details": {
          "assignmentId": "25b85f67-5977-40b6-b891-e278e59817b8",
          "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
          "subjectName": "عميل تحصيل الاختبار",
          "subjectSection": "customer_debts",
          "mode": "partial",
          "paymentMode": "partial",
          "amountUnits": 100
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "actorRole": "employee",
        "createdAt": "2026-10-22T22:33:25.523Z",
        "readAt": null
      }
    ],
    "unreadCount": 3,
    "nextBefore": null
  }
}
```

## PATCH /api/notifications/{id}/read

قراءة إشعار. الصلاحية: `authenticated`.

Removes notification for current user; repeated call may be 404.

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": 1,
    "read": true
  }
}
```

## POST /api/notifications/read-all

قراءة كل الإشعارات. الصلاحية: `authenticated`.



لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "read": 3
  }
}
```

## GET /api/notification-preferences

تفضيلات الإشعارات. الصلاحية: `authenticated`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "soundEnabled": true,
    "speechEnabled": false
  }
}
```

## PATCH /api/notification-preferences

تعديل صوت الإشعارات. الصلاحية: `authenticated`.



طلب JSON (مثال):

```json
{
  "soundEnabled": true,
  "speechEnabled": false
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "soundEnabled": true,
    "speechEnabled": false
  }
}
```

## GET /api/organization-settings

إعدادات المؤسسة. الصلاحية: `admin`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "settings": {
      "organizationId": "org-default",
      "systemName": "اختبار Android — بيانات مصطنعة",
      "timezone": "Africa/Tripoli",
      "locale": "ar-LY",
      "employeeSectionsVisible": true,
      "version": 1,
      "updatedAt": "2026-10-22 22:33:23"
    }
  }
}
```

## PATCH /api/organization-settings

تعديل إعدادات المؤسسة. الصلاحية: `admin`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "systemName": "اختبار Android",
  "timezone": "Africa/Tripoli",
  "employeeSectionsVisible": true
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "settings": {
      "organizationId": "org-default",
      "systemName": "اختبار Android — بيانات مصطنعة",
      "timezone": "Africa/Tripoli",
      "locale": "ar-LY",
      "employeeSectionsVisible": true,
      "version": 1,
      "updatedAt": "2026-10-22 22:33:23"
    }
  }
}
```

## GET /api/users

المستخدمون والصلاحيات القابلة للتعيين. الصلاحية: `admin`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "a9e84beb-8b4e-4cd6-8788-7be5cce76d64",
        "username": "android-admin",
        "displayName": "مدير الاختبار",
        "role": "admin",
        "isOwner": true,
        "isActive": true,
        "version": 1,
        "email": null,
        "mustChangePassword": false,
        "permissions": [],
        "sectionAccess": {
          "customerDebts": "manage",
          "companyDebts": "manage",
          "libyanDeposits": "manage",
          "egyptianDeposits": "manage",
          "masraweya": "manage",
          "purchases": "manage",
          "treasury": "manage",
          "reports": "manage"
        },
        "createdAt": "2026-10-22T22:33:24.308Z",
        "updatedAt": "2026-10-22T22:33:24.308Z"
      },
      {
        "id": "023445ca-7951-4ccf-82b3-f5698f08148c",
        "username": "android-collector",
        "displayName": "محصل الاختبار",
        "role": "employee",
        "isOwner": false,
        "isActive": true,
        "version": 1,
        "email": null,
        "mustChangePassword": false,
        "permissions": [
          "collections.read",
          "collections.write"
        ],
        "sectionAccess": {
          "customerDebts": "none",
          "companyDebts": "none",
          "libyanDeposits": "none",
          "egyptianDeposits": "none",
          "masraweya": "none",
          "purchases": "none",
          "treasury": "none",
          "reports": "none"
        },
        "createdAt": "2026-10-22T22:33:24.308Z",
        "updatedAt": "2026-10-22T22:33:24.308Z"
      },
      {
        "id": "b6885015-cb21-4636-a115-d511074485c8",
        "username": "android-limited",
        "displayName": "مشرف اختبار محدود",
        "role": "employee",
        "isOwner": false,
        "isActive": true,
        "version": 1,
        "email": null,
        "mustChangePassword": false,
        "permissions": [
          "collections.read",
          "companies.read",
          "debts.read",
          "egyptian_deposits.read",
          "libyan_deposits.read",
          "purchases.read",
          "reports.read",
          "treasury.read"
        ],
        "sectionAccess": {
          "customerDebts": "none",
          "companyDebts": "none",
          "libyanDeposits": "none",
          "egyptianDeposits": "none",
          "masraweya": "none",
          "purchases": "none",
          "treasury": "none",
          "reports": "none"
        },
        "createdAt": "2026-10-22T22:33:24.308Z",
        "updatedAt": "2026-10-22T22:33:24.308Z"
      }
    ],
    "assignablePermissions": [
      "debts.read",
      "debts.write",
      "companies.read",
      "companies.write",
      "libyan_deposits.read",
      "libyan_deposits.write",
      "egyptian_deposits.read",
      "egyptian_deposits.write",
      "collections.read",
      "collections.write",
      "masraweya.read",
      "masraweya.write",
      "purchases.read",
      "purchases.write",
      "purchases.finalize",
      "treasury.read",
      "treasury.write",
      "reports.read"
    ]
  }
}
```

## POST /api/users

إنشاء مستخدم. الصلاحية: `admin; owner required to create role=admin`.

Email required for admin. New employee temporary password requires change. Admin role bypasses section permissions; not a limited-manager role.

طلب JSON (مثال):

```json
{
  "username": "example-collector",
  "displayName": "محصل مثال",
  "role": "employee",
  "password": "<private letters and digits>",
  "permissions": [
    "collections.read",
    "collections.write"
  ],
  "customerDebtsAccess": "none",
  "companyDebtsAccess": "none",
  "libyanDepositsAccess": "none",
  "egyptianDepositsAccess": "none",
  "masraweyaAccess": "none",
  "purchasesAccess": "none",
  "treasuryAccess": "none",
  "reportsAccess": "none"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "023445ca-7951-4ccf-82b3-f5698f08148c",
      "username": "android-collector",
      "displayName": "محصل الاختبار",
      "role": "employee",
      "isOwner": false,
      "isActive": true,
      "version": 1,
      "email": null,
      "mustChangePassword": false,
      "permissions": [
        "collections.read",
        "collections.write"
      ],
      "sectionAccess": {
        "customerDebts": "none",
        "companyDebts": "none",
        "libyanDeposits": "none",
        "egyptianDeposits": "none",
        "masraweya": "none",
        "purchases": "none",
        "treasury": "none",
        "reports": "none"
      },
      "createdAt": "2026-10-22T22:33:24.308Z",
      "updatedAt": "2026-10-22T22:33:24.308Z"
    }
  }
}
```

## PATCH /api/users/{id}

تعديل مستخدم. الصلاحية: `admin; owner checks for protected/admin accounts`.

Password reset/deactivation revokes sessions. Do not include password unless deliberately resetting.

طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "displayName": "محصل معدل",
  "isActive": true,
  "permissions": [
    "collections.read",
    "collections.write"
  ],
  "customerDebtsAccess": "none",
  "companyDebtsAccess": "none",
  "libyanDepositsAccess": "none",
  "egyptianDepositsAccess": "none",
  "masraweyaAccess": "none",
  "purchasesAccess": "none",
  "treasuryAccess": "none",
  "reportsAccess": "none"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "023445ca-7951-4ccf-82b3-f5698f08148c",
      "username": "android-collector",
      "displayName": "محصل الاختبار",
      "role": "employee",
      "isOwner": false,
      "isActive": true,
      "version": 1,
      "email": null,
      "mustChangePassword": false,
      "permissions": [
        "collections.read",
        "collections.write"
      ],
      "sectionAccess": {
        "customerDebts": "none",
        "companyDebts": "none",
        "libyanDeposits": "none",
        "egyptianDeposits": "none",
        "masraweya": "none",
        "purchases": "none",
        "treasury": "none",
        "reports": "none"
      },
      "createdAt": "2026-10-22T22:33:24.308Z",
      "updatedAt": "2026-10-22T22:33:24.308Z"
    }
  }
}
```

## GET /api/account-requests

طلبات تسجيل Google. الصلاحية: `admin`.



لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": []
  }
}
```

## POST /api/account-requests/{id}/decision

قرار طلب تسجيل. الصلاحية: `admin`.



طلب JSON (مثال):

```json
{
  "expectedVersion": 1,
  "decision": "reject",
  "customerDebtsAccess": "none",
  "note": "مثال"
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "request": {
      "id": "<id>",
      "provider": "google",
      "email": "test@example.invalid",
      "displayName": "اختبار",
      "pictureUrl": null,
      "status": "rejected",
      "decisionNote": "مثال",
      "requestedAt": "2026-10-22T22:00:00.000Z",
      "decidedAt": "2026-10-22T22:01:00.000Z",
      "version": 2
    }
  }
}
```

## GET /api/audit-log

التدقيق. الصلاحية: `admin`.



المعاملات: `before` (Pass the previous nextBefore.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": 15,
        "action": "collection.unlinked.submit",
        "entityType": "collection_submission",
        "entityId": "ef293fb5-7a04-4e24-8624-3e02fd9c8115",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "subjectName": "استلام مستقل للاختبار",
          "subjectSection": "collections",
          "amountUnits": 75
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "createdAt": "2026-10-22T22:33:25.792Z"
      },
      {
        "id": 14,
        "action": "collection.submit",
        "entityType": "collection_submission",
        "entityId": "d37f68dd-814d-4a9b-908b-278e1a259b2f",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "assignmentId": "25b85f67-5977-40b6-b891-e278e59817b8",
          "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
          "subjectName": "عميل تحصيل الاختبار",
          "subjectSection": "customer_debts",
          "mode": "partial",
          "paymentMode": "partial",
          "amountUnits": 50
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "createdAt": "2026-10-22T22:33:25.715Z"
      },
      {
        "id": 13,
        "action": "collection.approve",
        "entityType": "collection_submission",
        "entityId": "ec6a801b-377e-4fb5-9aca-aa8efdb252ea",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "transactionId": "85d79c30-5e91-4853-868f-2e6be40d7860",
          "collectorId": "023445ca-7951-4ccf-82b3-f5698f08148c"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.564Z"
      },
      {
        "id": 12,
        "action": "customer.payment",
        "entityType": "debt_transaction",
        "entityId": "85d79c30-5e91-4853-868f-2e6be40d7860",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
          "subjectName": "عميل تحصيل الاختبار",
          "subjectSection": "customer_debts",
          "amountUnits": 100,
          "paymentMode": "partial",
          "sequence": 2,
          "suppressNotification": true
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "createdAt": "2026-10-22T22:33:25.563Z"
      },
      {
        "id": 11,
        "action": "collection.submit",
        "entityType": "collection_submission",
        "entityId": "ec6a801b-377e-4fb5-9aca-aa8efdb252ea",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "assignmentId": "25b85f67-5977-40b6-b891-e278e59817b8",
          "customerId": "0342102a-b304-4e81-a4b7-a08081516bfa",
          "subjectName": "عميل تحصيل الاختبار",
          "subjectSection": "customer_debts",
          "mode": "partial",
          "paymentMode": "partial",
          "amountUnits": 100
        },
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "createdAt": "2026-10-22T22:33:25.523Z"
      },
      {
        "id": 10,
        "action": "collection.assign",
        "entityType": "collection_submission",
        "entityId": "25b85f67-5977-40b6-b891-e278e59817b8",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "assigneeId": "023445ca-7951-4ccf-82b3-f5698f08148c",
          "customerIds": [
            "0342102a-b304-4e81-a4b7-a08081516bfa"
          ],
          "section": "customers"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.498Z"
      },
      {
        "id": 9,
        "action": "treasury.cash.in",
        "entityType": "treasury_cash_entry",
        "entityId": "e3b745cc-3c51-4d61-a411-5c8e672426ae",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "amountUnits": 500,
          "before": 0,
          "after": 500,
          "sequence": 1
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.469Z"
      },
      {
        "id": 8,
        "action": "purchases.entry.create",
        "entityType": "purchase_entry",
        "entityId": "d0f6a687-1267-471b-831e-a4568602d82c",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "merchant": "al_bayan",
          "sequence": 1,
          "subjectName": "مشتريات اختبار",
          "subjectSection": "purchases",
          "amountUnits": 100,
          "paidUnits": 20,
          "remainingUnits": 80,
          "vodafoneConsumedUnits": 100
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.400Z"
      },
      {
        "id": 7,
        "action": "purchases.opening.update",
        "entityType": "purchase_entry",
        "entityId": "9b294ca8-fc62-459e-ba56-5312e94681a9",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "merchant": "al_bayan"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.374Z"
      },
      {
        "id": 6,
        "action": "egyptian_deposit.create",
        "entityType": "egyptian_deposit",
        "entityId": "3f1487e2-9be7-4fce-944a-7889513b3fa4",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "openingBalanceUnits": 10000,
          "amountUnits": 10000,
          "subjectName": "أمانة مصرية اختبار",
          "subjectSection": "egyptian_deposits"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.216Z"
      },
      {
        "id": 5,
        "action": "libyan_deposit.create",
        "entityType": "libyan_deposit",
        "entityId": "f9190077-ed2b-4cdb-a937-deba81f17085",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "openingBalanceUnits": 300,
          "amountUnits": 300,
          "subjectName": "أمانة ليبية اختبار",
          "subjectSection": "libyan_deposits"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.182Z"
      },
      {
        "id": 4,
        "action": "company.create",
        "entityType": "company",
        "entityId": "6a5e98aa-4b58-4f80-9ca2-c4f83fec77ea",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "openingBalanceUnits": 2000,
          "amountUnits": 2000,
          "subjectName": "شركة المطابقة",
          "subjectSection": "company_debts"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.126Z"
      },
      {
        "id": 3,
        "action": "customer.create",
        "entityType": "customer",
        "entityId": "0342102a-b304-4e81-a4b7-a08081516bfa",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "openingBalanceUnits": 400,
          "amountUnits": 400,
          "subjectName": "عميل تحصيل الاختبار",
          "subjectSection": "customer_debts"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.075Z"
      },
      {
        "id": 2,
        "action": "customer.create",
        "entityType": "customer",
        "entityId": "f10ba11d-03b3-411b-a7c9-83fd74347002",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "openingBalanceUnits": 250,
          "amountUnits": 250,
          "subjectName": "عميل المطابقة باء",
          "subjectSection": "customer_debts"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:25.026Z"
      },
      {
        "id": 1,
        "action": "customer.create",
        "entityType": "customer",
        "entityId": "0850d816-6dc0-4d85-b46f-fb0a6ef1cb11",
        "correlationId": "android-fixture",
        "outcome": "success",
        "details": {
          "openingBalanceUnits": 1000,
          "amountUnits": 1000,
          "subjectName": "عميل المطابقة ألف",
          "subjectSection": "customer_debts"
        },
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "createdAt": "2026-10-22T22:33:24.990Z"
      }
    ],
    "nextBefore": null
  }
}
```

## GET /api/financial-ledger

سجل الأستاذ. الصلاحية: `admin`.

pageTotals are page totals only, not organization totals.

المعاملات: `before` (Opaque nextBefore)، `section` ({"type":"string"})، `currency` ({"type":"string","enum":["LYD","EGP"]})، `q` (Maximum120 characters).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": 9,
        "sourceKind": "debt_transaction",
        "sourceId": "85d79c30-5e91-4853-868f-2e6be40d7860",
        "sectionKey": "customer_debts",
        "entryKind": "payment",
        "counterpartyName": "عميل تحصيل الاختبار",
        "description": "استلام بواسطة محصل الاختبار",
        "referenceNo": "CUST-00000004",
        "currency": "LYD",
        "amountUnits": 100,
        "effectUnits": -100,
        "actorName": "محصل الاختبار",
        "actorUsername": "android-collector",
        "occurredAt": "2026-10-22T22:33:25.523Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.561Z"
      },
      {
        "id": 8,
        "sourceKind": "treasury_cash",
        "sourceId": "e3b745cc-3c51-4d61-a411-5c8e672426ae",
        "sectionKey": "treasury",
        "entryKind": "in",
        "counterpartyName": "الخزينة",
        "description": "نقدية اختبار مصطنعة",
        "referenceNo": "CASH-1",
        "currency": "LYD",
        "amountUnits": 500,
        "effectUnits": 500,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.469Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.469Z"
      },
      {
        "id": 7,
        "sourceKind": "purchase_entry",
        "sourceId": "d0f6a687-1267-471b-831e-a4568602d82c",
        "sectionKey": "purchases",
        "entryKind": "purchase",
        "counterpartyName": "البيان",
        "description": "مشتريات اختبار",
        "referenceNo": "PUR-1",
        "currency": "LYD",
        "amountUnits": 100,
        "effectUnits": 80,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.399Z",
        "sourceStatus": "draft",
        "updatedAt": "2026-10-22T22:33:25.399Z"
      },
      {
        "id": 6,
        "sourceKind": "debt_transaction",
        "sourceId": "7a3b66e1-faef-4aa6-8ade-7078caaf252f",
        "sectionKey": "egyptian_deposits",
        "entryKind": "debt",
        "counterpartyName": "أمانة مصرية اختبار",
        "description": "رصيد افتتاحي",
        "referenceNo": "EDEP-00000001",
        "currency": "EGP",
        "amountUnits": 10000,
        "effectUnits": 10000,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.214Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.214Z"
      },
      {
        "id": 5,
        "sourceKind": "debt_transaction",
        "sourceId": "a914c23a-ef4a-4731-9ae1-418bd0c13424",
        "sectionKey": "libyan_deposits",
        "entryKind": "debt",
        "counterpartyName": "أمانة ليبية اختبار",
        "description": "رصيد افتتاحي",
        "referenceNo": "LDEP-00000001",
        "currency": "LYD",
        "amountUnits": 300,
        "effectUnits": 300,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.181Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.181Z"
      },
      {
        "id": 4,
        "sourceKind": "debt_transaction",
        "sourceId": "12481b8d-7408-49a5-b69b-5bff73f39603",
        "sectionKey": "company_debts",
        "entryKind": "debt",
        "counterpartyName": "شركة المطابقة",
        "description": "رصيد افتتاحي",
        "referenceNo": "COMP-00000001",
        "currency": "LYD",
        "amountUnits": 2000,
        "effectUnits": 2000,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.125Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.125Z"
      },
      {
        "id": 3,
        "sourceKind": "debt_transaction",
        "sourceId": "3c591515-aca0-4710-8edd-8cc6da0a9cd6",
        "sectionKey": "customer_debts",
        "entryKind": "debt",
        "counterpartyName": "عميل تحصيل الاختبار",
        "description": "رصيد افتتاحي",
        "referenceNo": "CUST-00000003",
        "currency": "LYD",
        "amountUnits": 400,
        "effectUnits": 400,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.074Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.074Z"
      },
      {
        "id": 2,
        "sourceKind": "debt_transaction",
        "sourceId": "1260f085-30b2-44e1-a86a-6a8ee21dab50",
        "sectionKey": "customer_debts",
        "entryKind": "debt",
        "counterpartyName": "عميل المطابقة باء",
        "description": "رصيد افتتاحي",
        "referenceNo": "CUST-00000002",
        "currency": "LYD",
        "amountUnits": 250,
        "effectUnits": 250,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:25.025Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:25.025Z"
      },
      {
        "id": 1,
        "sourceKind": "debt_transaction",
        "sourceId": "bccb4ebf-899c-4170-8df3-f742edaebc4b",
        "sectionKey": "customer_debts",
        "entryKind": "debt",
        "counterpartyName": "عميل المطابقة ألف",
        "description": "رصيد افتتاحي",
        "referenceNo": "CUST-00000001",
        "currency": "LYD",
        "amountUnits": 1000,
        "effectUnits": 1000,
        "actorName": "مدير الاختبار",
        "actorUsername": "android-admin",
        "occurredAt": "2026-10-22T22:33:24.984Z",
        "sourceStatus": "posted",
        "updatedAt": "2026-10-22T22:33:24.984Z"
      }
    ],
    "pageTotals": {
      "LYD": 4430,
      "EGP": 10000
    },
    "nextBefore": null
  }
}
```

## GET /api/masraweya/day

يوم المصراوية. الصلاحية: `masraweya.read`.



المعاملات: `date` (Defaults to current business date starting04:00 Africa/Tripoli.).

لا يوجد جسم طلب مطلوب.

رد نجاح مقاس فعليًا:

```json
{
  "ok": true,
  "data": {
    "id": null,
    "businessDate": "2026-10-22",
    "today": "2026-10-22",
    "earliestEditableDate": "2026-10-15",
    "editable": true,
    "previousValueUnits": 0,
    "purchasesUnits": 0,
    "workTotalUnits": 0,
    "finalUnits": 0,
    "carryValueUnits": null,
    "carrySourceDate": null,
    "openingEditable": true,
    "historicalAdjustmentUnits": 0,
    "version": 0,
    "updatedAt": null,
    "updatedByName": null,
    "updatedByIsOwner": false,
    "entries": []
  }
}
```

## PUT /api/masraweya/day

حفظ المصراوية تلقائيًا. الصلاحية: `masraweya.write`.

EGP. Current day and previous7 days writable. Opening automatic except first seed day. Same content replayed:true. Old finalize/correction endpoints return410 MASRAWEYA_AUTOMATIC_WORKFLOW.

طلب JSON (مثال):

```json
{
  "businessDate": "2026-10-23",
  "expectedVersion": 0,
  "previousValueUnits": 0,
  "purchasesUnits": 1000,
  "entries": [
    {
      "valueUnits": 100,
      "commissionUnits": 5
    }
  ]
}
```

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "id": null,
    "businessDate": "2026-10-22",
    "today": "2026-10-22",
    "earliestEditableDate": "2026-10-15",
    "editable": true,
    "previousValueUnits": 0,
    "purchasesUnits": 1000,
    "workTotalUnits": 105,
    "finalUnits": 895,
    "carryValueUnits": null,
    "carrySourceDate": null,
    "openingEditable": true,
    "historicalAdjustmentUnits": 0,
    "version": 1,
    "updatedAt": null,
    "updatedByName": null,
    "updatedByIsOwner": false,
    "entries": [],
    "replayed": false,
    "eventSequences": [
      16
    ]
  }
}
```

## GET /api/event-changes

تغيرات منذ المؤشر. الصلاحية: `any section read permission`.

fullResync:true requires refetching snapshots. Advance cursor after successful application; latest can advance with no visible events.

المعاملات: `after` ({"type":"integer","minimum":0,"default":0}).

لا يوجد جسم طلب مطلوب.

رد نجاح توضيحي من الكود:

```json
{
  "ok": true,
  "data": {
    "events": [],
    "latest": 0,
    "fullResync": false
  }
}
```

## أمثلة الأخطاء الفعلية

### unauthenticated — HTTP 401

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "يجب تسجيل الدخول أولًا.",
    "correlationId": "beb20a75-9659-49e1-b54a-ca1c723b3ca3"
  }
}
```

### csrfError — HTTP 403

```json
{
  "ok": false,
  "error": {
    "code": "CSRF_REJECTED",
    "message": "رمز حماية الطلب مفقود أو غير صالح.",
    "correlationId": "7f87f7dc-1183-48a1-834b-2e5accc31d12"
  }
}
```

### versionHeaderError — HTTP 409

```json
{
  "ok": false,
  "error": {
    "code": "CLIENT_VERSION_MISMATCH",
    "message": "إصدار الواجهة غير متوافق مع الخادم. احتفظ بالمسودة ثم حدّث الواجهة.",
    "details": {
      "requiredApiVersion": "1",
      "receivedApiVersion": "0"
    },
    "correlationId": "afb486ed-39a1-40a8-a932-8e1fb6efe4ab"
  }
}
```

### invalidAmount — HTTP 400

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "القيمة المالية يجب أن تكون رقمًا صحيحًا موجبًا بدون كسور.",
    "details": {
      "field": "inputValue"
    },
    "correlationId": "3e39ad08-a753-4ed9-b41f-252ba9b18a6c"
  }
}
```

### versionConflict — HTTP 409

```json
{
  "ok": false,
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "عُدّل الحساب على جهاز آخر. حدّث البيانات ثم حاول مجددًا.",
    "details": {
      "expectedVersion": 1,
      "currentVersion": 2
    },
    "correlationId": "2b436187-ecfc-45d9-a0fa-ca289cb3620d"
  }
}
```

### reusedId — HTTP 409

```json
{
  "ok": false,
  "error": {
    "code": "REQUEST_ID_REUSED",
    "message": "استُخدم معرّف الطلب من قبل لمحتوى مختلف.",
    "correlationId": "58c80faa-0b9b-4a60-9ada-32a6089aaf20"
  }
}
```

### duplicateWarning — HTTP 409

```json
{
  "ok": false,
  "error": {
    "code": "DUPLICATE_SAME_WORKDAY",
    "message": "توجد معاملة مماثلة في نفس المكان خلال يوم العمل الحالي. هل تريد إضافتها مرة أخرى؟",
    "correlationId": "b7eb44bf-1357-4778-b46c-64fa6d94fa06"
  }
}
```

### limitedForbidden — HTTP 403

```json
{
  "ok": false,
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "ليست لديك صلاحية لهذه العملية.",
    "details": {
      "permission": "collections.review"
    },
    "correlationId": "a24281c3-e401-4ece-bba9-fbe34c17d926"
  }
}
```
