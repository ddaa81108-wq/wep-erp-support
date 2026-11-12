# جرد إشعارات الإدارة والدفع — اقتراح، وليس تنفيذًا داخل التطبيق

صفوف الإشعار داخل التطبيق لم تُغيَّر. الدفع للمدير يتبع الصف الموجود اليوم: كل مدير غير صاحب العملية يصله دفع إن وُجد له صف. الموظف ما زال يصله دفع عن `collection.assign` فقط إذا كانت لديه `collections.read`.

القاعدة الحالية للصف: كل إدراج ناجح في `audit_log` ينشئ صفًا لكل مدير نشط غير الفاعل، ما لم يكن الفاعل المالك (`is_owner`) أو كانت التفاصيل `suppressNotification`. لا يُكتب اليوم أي صف بنتيجة `denied` أو `failure`.

## ما يُشعر المدير داخل التطبيق، ويدفع إليه

| نوع الحدث | صف للمدير | دفع للمدير |
| --- | --- | --- |
| customer.create / update / pin / delete / zero_review | نعم | نعم |
| customer.debt / payment | نعم | نعم |
| customer.transaction.update / cancel | نعم | نعم |
| company.create / update / pin / delete / zero_review | نعم | نعم |
| company.debt / payment | نعم | نعم |
| company.transaction.update / cancel | نعم | نعم |
| libyan_deposit.create / update / pin / delete / zero_review | نعم | نعم |
| libyan_deposit.debt / payment | نعم | نعم |
| libyan_deposit.transaction.update / cancel | نعم | نعم |
| egyptian_deposit.create / update / pin / delete / zero_review | نعم | نعم |
| egyptian_deposit.debt / payment | نعم | نعم |
| egyptian_deposit.transaction.update / cancel | نعم | نعم |
| collection.assign | نعم (والموظف الموجَّه إليه) | نعم للمدير؛ وللموظف فقط إن كانت لديه collections.read |
| collection.unassign | نعم | نعم |
| collection.submit / approve / reject / cash_received | نعم | نعم |
| collection.unlinked.submit / approve / reject / cash_received | نعم | نعم |
| collection.batch.close | نعم | نعم |
| collection.approval.cancel | نعم | نعم |
| collection.payroll.entry.create / salary.update | نعم من سجل التدقيق؛ وصف إضافي للموظف | نعم للمدير؛ لا للموظف |
| collection.payroll.entry.confirm | نعم | نعم |
| purchases.entry.create / update / delete | نعم | نعم |
| purchases.opening.update | نعم | نعم |
| purchases.day.finalize / correction.open / correction.close | نعم | نعم |
| masraweya.save | نعم | نعم |
| treasury.cash.in / treasury.cash.out | نعم | نعم |
| treasury.cash.correct | نعم | نعم |
| user.create / user.update | نعم | نعم |
| user.password.change | نعم | نعم |
| user.mfa.enable / user.mfa.disable | نعم | نعم |
| account_request.approve / reject | نعم | نعم |
| settings.organization.update | نعم | نعم |
| session.revoke | نعم | نعم |

المدير الذي نفّذ العملية لا يصله صف، وبالتالي لا يصله دفع. هذا سلوك الصف الحالي ولم يُغيَّر.

`system.first_admin.create` يُكتب في التدقيق والفاعل مالك، فالصف لا يُنشأ والدفع لا يخرج.

## موجود في النظام بلا صف إشعار — اقتراح فقط

لا يُضاف صف داخل التطبيق لهذه البنود إلا بقرار لاحق.

| الحدث | أين يُحفظ اليوم | الاقتراح |
| --- | --- | --- |
| دخول ناجح | صف في `sessions` فقط | صف تدقيق `auth.login` ثم دفع للمديرين |
| دخول فاشل | `login_failures` فقط | صف تدقيق `auth.login_failed` بلا كلمة المرور، ثم دفع |
| حد محاولات الدخول وازدحام الدخول | رد HTTP فقط | نفس اقتراح الدخول الفاشل |
| طلب رمز MFA قبل إكمال الدخول | رد HTTP فقط | صف `auth.mfa_challenge` ثم دفع |
| فشل رمز MFA | `login_failures` | صف `auth.mfa_failed` ثم دفع |
| إنشاء الجلسة | `sessions` | يغطيه اقتراح الدخول الناجح |
| إلغاء جلسات أخرى عند تغيير كلمة المرور أو إيقاف MFA | تحديث `sessions`، والتدقيق الموجود هو `user.password.change` أو `user.mfa.disable` | الدفع موجود لهذين التدقيقين؛ لا صف منفصل لكل جلسة أُلغيت |
| أخطاء الخادم | `technical_events` | صف `system.error` للمديرين ثم دفع، بلا أثر جانبي على العملية |
| مواضيع البث `event_log` | بث حي فقط | ليست إشعارًا؛ لا دفع منفصل ما دام التدقيق نفسه يُدفع |
| نتيجة `denied` أو `failure` في التدقيق | العمود موجود ولا يُكتب اليوم | عند أول استخدام، الصف الحالي يتجاهلها؛ الاقتراح إبقاؤها خارج الصف ودفعها للمديرين بمسار منفصل |
