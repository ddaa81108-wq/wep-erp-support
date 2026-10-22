import { uiText } from '../../i18n/language.ts';
import type { AuditEntry } from '../../api.ts';

export type AuditFilter = 'all' | 'financial' | 'accounts' | 'system';

export const auditNumberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

const actionLabels: Record<string, string> = {
  'system.first_admin.create': uiText("إنشاء حساب المدير الأول"),
  'customer.create': uiText("إضافة عميل"),
  'customer.debt': uiText("إضافة دين عميل"),
  'customer.payment': uiText("تسديد عميل"),
  'customer.update': uiText("تعديل بيانات عميل"),
  'customer.transaction.update': uiText("تعديل معاملة عميل"),
  'customer.transaction.cancel': uiText("إلغاء معاملة عميل"),
  'company.create': uiText("إضافة شركة"),
  'company.debt': uiText("إضافة دين شركة"),
  'company.payment': uiText("تسديد شركة"),
  'company.update': uiText("تعديل بيانات شركة"),
  'company.transaction.update': uiText("تعديل معاملة شركة"),
  'company.transaction.cancel': uiText("إلغاء معاملة شركة"),
  'deposit.create': uiText("إضافة أمانة"),
  'deposit.debt': uiText("دخول أمانة"),
  'deposit.payment': uiText("خروج أمانة"),
  'libyan_deposit.create': uiText("إضافة أمانة ليبية"),
  'libyan_deposit.debt': uiText("دخول أمانة ليبية"),
  'libyan_deposit.payment': uiText("خروج أمانة ليبية"),
  'egyptian_deposit.create': uiText("إضافة أمانة مصرية"),
  'egyptian_deposit.debt': uiText("دخول أمانة مصرية"),
  'egyptian_deposit.payment': uiText("خروج أمانة مصرية"),
  'treasury.cash.in': uiText("دخول نقدية للخزينة"),
  'treasury.cash.out': uiText("خروج نقدية من الخزينة"),
  'purchases.entry.create': uiText("إضافة معاملة مشتريات"),
  'purchases.entry.update': uiText("تعديل معاملة مشتريات"),
  'purchases.entry.delete': uiText("حذف معاملة مشتريات"),
  'purchases.day.finalize': uiText("ترحيل يوم المشتريات"),
  'purchases.day.correction.open': uiText("فتح تعديل يوم مشتريات"),
  'purchases.day.correction.close': uiText("إغلاق تعديل يوم مشتريات"),
  'masraweya.day.save': uiText("حفظ يوم المصراوية"),
  'masraweya.day.finalize': uiText("اعتماد يوم المصراوية"),
  'masraweya.day.correction.open': uiText("فتح تعديل يوم المصراوية"),
  'masraweya.day.correction.close': uiText("إغلاق تعديل يوم المصراوية"),
  'collection.assign': uiText("توجيه كروت"),
  'collection.submit': uiText("تسجيل استلام"),
  'collection.approve': uiText("اعتماد استلام"),
  'collection.reject': uiText("رفض استلام"),
  'collection.cash_received': uiText("استلام النقدية"),
  'user.create': uiText("إنشاء حساب"),
  'user.update': uiText("تعديل حساب"),
  'user.password.change': uiText("تغيير كلمة المرور"),
  'account_request.approve': uiText("قبول طلب انضمام"),
  'account_request.reject': uiText("رفض طلب انضمام"),
  'settings.organization.update': uiText("تعديل إعدادات المنظومة"),
};

const entityLabels: Record<string, string> = {
  customer: uiText("عميل"),
  company: uiText("شركة"),
  debt_transaction: uiText("معاملة مالية"),
  treasury_cash_entry: uiText("الخزينة"),
  user: uiText("حساب مستخدم"),
  organization_settings: uiText("إعدادات المنظومة"),
  purchase_entry: uiText("المشتريات"),
  purchase_day: uiText("يوم مشتريات"),
  collection: uiText("استلامات الديون"),
  masraweya_day: uiText("المصراوية"),
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
  if (Number.isSafeInteger(amount)) return uiText("{0} د.ل", [auditNumberFormat.format(amount)]);
  const sequence = Number(details.sequence);
  if (Number.isSafeInteger(sequence)) return uiText("التسلسل {0}", [auditNumberFormat.format(sequence)]);
  if (details.passwordReset === true) return uiText("إعادة تعيين كلمة المرور");
  if (details.isActive === false) return uiText("تم تعطيل الحساب");
  if (details.isActive === true) return uiText("الحساب نشط");
  return entityLabels[entry.entityType] ?? uiText("حركة مسجلة");
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
