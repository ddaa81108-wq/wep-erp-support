import type { AuditEntry } from '../../api.ts';

export type AuditFilter = 'all' | 'financial' | 'accounts' | 'system';

export const auditNumberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

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

const entityLabels: Record<string, string> = {
  customer: 'عميل',
  company: 'شركة',
  debt_transaction: 'معاملة مالية',
  treasury_cash_entry: 'الخزينة',
  user: 'حساب مستخدم',
  organization_settings: 'إعدادات المنظومة',
  purchase_entry: 'المشتريات',
  purchase_day: 'يوم مشتريات',
  collection: 'استلامات الديون',
  masraweya_day: 'المصراوية',
};

export function auditCategory(entry: AuditEntry): Exclude<AuditFilter, 'all'> {
  if (entry.action.startsWith('user.') || entry.action.startsWith('account_request.')) return 'accounts';
  if (entry.action.includes('password') || entry.action.includes('session') || entry.action.startsWith('settings.')) return 'system';
  return 'financial';
}

export function auditActionLabel(action: string) {
  return actionLabels[action] ?? action.split('.').join(' ← ');
}

export function auditEntityLabel(entityType: string) {
  return entityLabels[entityType] ?? entityType;
}

export function auditDetailText(entry: AuditEntry) {
  const details = entry.details;
  const amount = Number(details.amountUnits);
  if (Number.isSafeInteger(amount)) return `${auditNumberFormat.format(amount)} د.ل`;
  const sequence = Number(details.sequence);
  if (Number.isSafeInteger(sequence)) return `التسلسل ${auditNumberFormat.format(sequence)}`;
  if (details.passwordReset === true) return 'إعادة تعيين كلمة المرور';
  if (details.isActive === false) return 'تم تعطيل الحساب';
  if (details.isActive === true) return 'الحساب نشط';
  return entityLabels[entry.entityType] ?? 'حركة مسجلة';
}

export function filterAuditEntries(items: readonly AuditEntry[], query: string, filter: AuditFilter) {
  const needle = query.trim().toLocaleLowerCase('ar');
  return items.filter((entry) => {
    if (filter !== 'all' && auditCategory(entry) !== filter) return false;
    if (!needle) return true;
    return `${auditActionLabel(entry.action)} ${entry.actorName} ${entry.actorUsername ?? ''} ${auditEntityLabel(entry.entityType)} ${auditDetailText(entry)}`
      .toLocaleLowerCase('ar')
      .includes(needle);
  });
}
