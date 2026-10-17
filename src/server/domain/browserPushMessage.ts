const actionLabels: Record<string, string> = {
  'system.first_admin.create': 'إنشاء حساب المدير الأول',
  'customer.create': 'إضافة عميل',
  'customer.debt': 'إضافة دين عميل',
  'customer.payment': 'تسديد عميل',
  'customer.update': 'تعديل بيانات عميل',
  'customer.transaction.update': 'تعديل معاملة عميل',
  'customer.transaction.cancel': 'إلغاء معاملة عميل',
  'company.create': 'إضافة شركة',
  'company.debt': 'إضافة دين شركة',
  'company.payment': 'تسديد شركة',
  'company.update': 'تعديل بيانات شركة',
  'company.transaction.update': 'تعديل معاملة شركة',
  'company.transaction.cancel': 'إلغاء معاملة شركة',
  'deposit.create': 'إضافة أمانة',
  'deposit.debt': 'دخول أمانة',
  'deposit.payment': 'خروج أمانة',
  'libyan_deposit.create': 'إضافة أمانة ليبية',
  'libyan_deposit.debt': 'دخول أمانة ليبية',
  'libyan_deposit.payment': 'خروج أمانة ليبية',
  'egyptian_deposit.create': 'إضافة أمانة مصرية',
  'egyptian_deposit.debt': 'دخول أمانة مصرية',
  'egyptian_deposit.payment': 'خروج أمانة مصرية',
  'treasury.cash.in': 'دخول نقدية للخزينة',
  'treasury.cash.out': 'خروج نقدية من الخزينة',
  'purchases.entry.create': 'إضافة معاملة مشتريات',
  'purchases.entry.update': 'تعديل معاملة مشتريات',
  'purchases.entry.delete': 'حذف معاملة مشتريات',
  'purchases.day.finalize': 'ترحيل يوم المشتريات',
  'purchases.day.correction.open': 'فتح تعديل يوم مشتريات',
  'purchases.day.correction.close': 'إغلاق تعديل يوم مشتريات',
  'masraweya.day.save': 'حفظ يوم المصراوية',
  'masraweya.day.finalize': 'اعتماد يوم المصراوية',
  'masraweya.day.correction.open': 'فتح تعديل يوم المصراوية',
  'masraweya.day.correction.close': 'إغلاق تعديل يوم المصراوية',
  'collection.assign': 'توجيه كروت',
  'collection.submit': 'تسجيل استلام',
  'collection.approve': 'اعتماد استلام',
  'collection.reject': 'رفض استلام',
  'collection.cash_received': 'استلام النقدية',
  'user.create': 'إنشاء حساب',
  'user.update': 'تعديل حساب',
  'user.password.change': 'تغيير كلمة المرور',
  'account_request.approve': 'قبول طلب انضمام',
  'account_request.reject': 'رفض طلب انضمام',
  'settings.organization.update': 'تعديل إعدادات المنظومة',
};

// Only actor and action are exposed on device notifications; never amounts or notes.
export function browserPushMessage(action: string, actor: string, paymentMode?: string) {
  let label = actionLabels[action] ?? 'عملية جديدة في المنظومة';
  if (['customer.payment', 'company.payment', 'collection.submit'].includes(action)) {
    label = paymentMode === 'full' ? 'دفع كلي' : paymentMode === 'partial' ? 'دفع جزئي' : label;
  }
  return (actor.trim().slice(0, 100) || 'النظام') + ' — ' + label;
}
