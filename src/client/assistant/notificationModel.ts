import type { NotificationItem } from '../api.ts';
import { auditActionLabel } from '../sections/settings/auditLogModel.ts';

const amounts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function subjectLabel(details: Record<string, unknown>) {
  const section = String(details.subjectSection ?? '');
  if (section === 'company_debts') return 'للشركة';
  if (section === 'libyan_deposits') return 'بحساب الأمانة الليبية';
  if (section === 'egyptian_deposits') return 'بحساب الأمانة المصرية';
  if (section === 'purchases') return 'في المشتريات';
  if (section === 'treasury') return 'في الخزينة';
  return 'للعميل';
}

function subjectText(details: Record<string, unknown>) {
  const name = typeof details.subjectName === 'string' ? details.subjectName.trim() : '';
  return name ? `${subjectLabel(details)} ${name}` : '';
}

function amountText(details: Record<string, unknown>) {
  const amount = Number(details.amountUnits);
  if (!Number.isSafeInteger(amount)) return '';
  const currency = String(details.subjectSection ?? '') === 'egyptian_deposits' ? 'ج.م' : 'د.ل';
  return `بقيمة ${amounts.format(amount)} ${currency}`;
}

function actorText(item: NotificationItem) {
  return `${item.actorRole === 'admin' ? 'الإداري' : 'الموظف'} ${item.actorName}`;
}

function integerDetail(details: Record<string, unknown>, key: string) {
  const value = Number(details[key]);
  return Number.isSafeInteger(value) ? value : 0;
}

function purchaseEntrySentence(item: NotificationItem, actor: string) {
  const details = item.details;
  const result = integerDetail(details, 'amountUnits');
  const paid = integerDetail(details, 'paidUnits');
  const consumed = integerDetail(details, 'vodafoneConsumedUnits');
  const label = typeof details.subjectName === 'string' ? details.subjectName.trim() : '';
  const itemText = label && !['تسديد', 'مستهلك فودافون', 'تسديد واستهلاك فودافون'].includes(label)
    ? ` (${label})` : '';
  const parts: string[] = [];

  if (result !== 0) parts.push(`شراء${itemText} بقيمة ${amounts.format(result)} د.ل`);
  if (paid !== 0) parts.push(`تسديد ${amounts.format(paid)} د.ل`);
  if (consumed !== 0) parts.push(`استهلاك فودافون ${amounts.format(consumed)} ج.م`);

  if (parts.length === 0) {
    return `${actor} سجّل معاملة مشتريات بدون قيمة مالية.`;
  }
  return `${actor} سجّل ${parts.join('، ')}.`;
}

function payrollSentence(item: NotificationItem, actor: string) {
  const details = item.details;
  const amount = integerDetail(details, 'amountUnits');
  const kind = String(details.payrollKind ?? '');
  const employee = typeof details.employeeName === 'string' ? details.employeeName.trim() : '';
  const reason = typeof details.reason === 'string' ? details.reason.trim() : '';
  const target = employee ? ` للموظف ${employee}` : '';
  const label = kind === 'commission' ? 'عمولة أو مكافأة' : 'سحب';
  if (item.action === 'collection.payroll.entry.confirm') {
    return `${actor} أكد استلام ${label} بقيمة ${amounts.format(amount)} د.ل${reason ? ` بسبب ${reason}` : ''}.`;
  }
  if (item.action === 'collection.payroll.salary.update') {
    return `${actor} حدّث المرتب الثابت${target} إلى ${amounts.format(amount)} د.ل.`;
  }
  return `${actor} أضاف ${label}${target} بقيمة ${amounts.format(amount)} د.ل${reason ? ` بسبب ${reason}` : ''}.`;
}

export function notificationSentence(item: NotificationItem) {
  const actor = actorText(item);
  if (item.action === 'purchases.entry.create' || item.action === 'purchases.entry.update') {
    return purchaseEntrySentence(item, actor);
  }
  if (item.action.startsWith('collection.payroll.')) {
    return payrollSentence(item, actor);
  }
  const subject = subjectText(item.details);
  const amount = amountText(item.details);
  const suffix = [amount, subject].filter(Boolean).join(' ');
  const paymentMode = String(item.details.paymentMode ?? item.details.mode ?? '');

  if (item.action === 'collection.submit') {
    const mode = paymentMode === 'full' ? 'تسديدًا كليًا' : 'تسديدًا جزئيًا';
    return `${actor} سجّل ${mode}${suffix ? ` ${suffix}` : ''}.`;
  }
  if (item.action === 'collection.unlinked.submit') {
    return `${actor} سجّل استلامًا غير مربوط${suffix ? ` ${suffix}` : ''} وينتظر ربط الإدارة.`;
  }
  if (item.action.endsWith('.payment')) {
    const mode = paymentMode === 'full' ? 'تسديدًا كليًا' : 'تسديدًا جزئيًا';
    return `${actor} سجّل ${mode}${suffix ? ` ${suffix}` : ''}.`;
  }
  if (item.action.endsWith('.debt')) {
    return `${actor} أضاف دينًا${suffix ? ` ${suffix}` : ''}.`;
  }
  if (item.action.endsWith('.create')) {
    return `${actor} نفّذ «${auditActionLabel(item.action)}»${suffix ? ` ${suffix}` : ''}.`;
  }
  if (item.action.endsWith('.update')) {
    return `${actor} عدّل ${subject || auditActionLabel(item.action)}${amount ? ` ${amount}` : ''}.`;
  }
  if (item.action.endsWith('.cancel')) {
    return `${actor} ألغى معاملة ${subject || ''}.`.replace(/\s+\./u, '.');
  }
  if (item.action === 'collection.assign') {
    const count = Array.isArray(item.details.customerIds) ? item.details.customerIds.length : 0;
    return `${actor} وجّه ${count || ''} ${count === 1 ? 'كارت' : 'كروت'} للتحصيل.`.replace(/\s+/g, ' ');
  }
  return `${actor} نفّذ «${auditActionLabel(item.action)}»${suffix ? ` ${suffix}` : ''}.`;
}
