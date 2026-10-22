/* No fetch handler or API caching: financial requests always reach the server. */
// This isolated worker catalog mirrors the application action labels.
const pushEnglish = {
  'دفع كلي': 'Full payment',
  'دفع جزئي': 'Partial payment',
  'عملية جديدة في المنظومة': 'New system activity',
  'إنشاء حساب المدير الأول': 'Create first administrator account',
  'إضافة عميل': 'Add customer',
  'إضافة دين عميل': 'Add customer debt',
  'تسديد عميل': 'Customer payment',
  'تعديل بيانات عميل': 'Edit customer details',
  'تعديل معاملة عميل': 'Edit customer transaction',
  'إلغاء معاملة عميل': 'Cancel customer transaction',
  'إضافة شركة': 'Add company',
  'إضافة دين شركة': 'Add company debt',
  'تسديد شركة': 'Company payment',
  'تعديل بيانات شركة': 'Edit company details',
  'تعديل معاملة شركة': 'Edit company transaction',
  'إلغاء معاملة شركة': 'Cancel company transaction',
  'إضافة أمانة': 'Add deposit',
  'دخول أمانة': 'Deposit inflow',
  'خروج أمانة': 'Deposit outflow',
  'إضافة أمانة ليبية': 'Add Libyan deposit',
  'دخول أمانة ليبية': 'Libyan deposit inflow',
  'خروج أمانة ليبية': 'Libyan deposit outflow',
  'إضافة أمانة مصرية': 'Add Egyptian deposit',
  'دخول أمانة مصرية': 'Egyptian deposit inflow',
  'خروج أمانة مصرية': 'Egyptian deposit outflow',
  'دخول نقدية للخزينة': 'Treasury cash inflow',
  'خروج نقدية من الخزينة': 'Treasury cash outflow',
  'إضافة معاملة مشتريات': 'Add purchase transaction',
  'تعديل معاملة مشتريات': 'Edit purchase transaction',
  'حذف معاملة مشتريات': 'Delete purchase transaction',
  'ترحيل يوم المشتريات': 'Finalize purchase day',
  'فتح تعديل يوم مشتريات': 'Open purchase day for editing',
  'إغلاق تعديل يوم مشتريات': 'Close purchase day editing',
  'حفظ يوم المصراوية': 'Save Masraweya day',
  'اعتماد يوم المصراوية': 'Approve Masraweya day',
  'فتح تعديل يوم المصراوية': 'Open Masraweya day for editing',
  'إغلاق تعديل يوم المصراوية': 'Close Masraweya day editing',
  'توجيه كروت': 'Assign cards',
  'تسجيل استلام': 'Record collection',
  'اعتماد استلام': 'Approve collection',
  'رفض استلام': 'Reject collection',
  'استلام النقدية': 'Receive cash',
  'إنشاء حساب': 'Create account',
  'تعديل حساب': 'Edit account',
  'تغيير كلمة المرور': 'Change password',
  'قبول طلب انضمام': 'Approve join request',
  'رفض طلب انضمام': 'Reject join request',
  'تعديل إعدادات المنظومة': 'Edit system settings',
};
const preferenceCache = 'abdo-ui-preferences-v1';
const preferencePath = '/__abdo_ui_language__';
self.addEventListener('message', (event) => {
  const value = event.data;
  if (value?.type !== 'abdo:set-language' || !['ar', 'en'].includes(value.language)) return;
  event.waitUntil(
    caches
      .open(preferenceCache)
      .then((cache) => cache.put(preferencePath, new Response(value.language)))
      .catch(() => undefined),
  );
});
async function notificationLanguage() {
  try {
    if (typeof caches === 'undefined') return 'ar';
    const cached = await (await caches.open(preferenceCache)).match(preferencePath);
    return cached && (await cached.text()) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}
function localizedBody(body, language) {
  if (language === 'ar') return body;
  const separator = body.lastIndexOf(' — ');
  const label = separator >= 0 ? body.slice(separator + 3) : body;
  const translated = Object.hasOwn(pushEnglish, label) ? pushEnglish[label] : undefined;
  if (translated) return separator >= 0 ? body.slice(0, separator + 3) + translated : translated;
  return /\p{Script=Arabic}/u.test(body) ? 'New system activity. Open the app to review.' : body;
}
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    const received = event.data ? event.data.json() : {};
    payload = received && typeof received === 'object' ? received : {};
  } catch {
    /* Generic notification remains visible. */
  }
  event.waitUntil(
    Promise.all([
      typeof payload.badgeCount === 'number' && payload.badgeCount > 0 && 'setAppBadge' in self.registration
        ? self.registration.setAppBadge(payload.badgeCount).catch(() => undefined)
        : payload.badgeCount === 0 && 'clearAppBadge' in self.registration
          ? self.registration.clearAppBadge().catch(() => undefined)
          : Promise.resolve(),
      notificationLanguage().then((language) =>
        self.registration.showNotification('VIB Abdo Company', {
          body:
            typeof payload.body === 'string' && payload.body.trim()
              ? localizedBody(payload.body, language).slice(0, 240)
              : language === 'en'
                ? 'You have a new notification. Open the app to review.'
                : 'لديك إشعار جديد في المنظومة. افتحها للمراجعة.',
          icon: '/push-icon.svg',
          badge: '/push-icon.svg',
          tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 100) : 'abdo-erp',
          data: { url: language === 'en' ? '/erp?lang=en' : '/erp' },
          dir: language === 'en' ? 'ltr' : 'rtl',
          lang: language,
        }),
      ),
    ]),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const page = pages.find(
        (client) =>
          new URL(client.url).origin === self.location.origin && new URL(client.url).pathname === '/erp',
      );
      if (page) return page.focus();
      return self.clients.openWindow(
        event.notification.data?.url === '/erp?lang=en' ? '/erp?lang=en' : '/erp',
      );
    })(),
  );
});
