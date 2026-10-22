import { uiText } from '../i18n/language.ts';
import type { NotificationItem } from '../api.ts';
import { auditActionLabel } from '../sections/settings/auditLogModel.ts';

const amounts = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function subjectLabel(details: Record<string, unknown>) {
  const section = String(details.subjectSection ?? '');
  if (section === 'company_debts') return uiText("للشركة");
  if (section === 'libyan_deposits') return uiText("بحساب الأمانة الليبية");
  if (section === 'egyptian_deposits') return uiText("بحساب الأمانة المصرية");
  if (section === 'purchases') return uiText("في المشتريات");
  if (section === 'treasury') return uiText("في الخزينة");
  return uiText("للعميل");
}

function subjectText(details: Record<string, unknown>) {
  const name = typeof details.subjectName === 'string' ? details.subjectName.trim() : '';
  return name ? `${subjectLabel(details)} ${name}` : '';
}

function amountText(details: Record<string, unknown>) {
  const amount = Number(details.amountUnits);
  if (!Number.isSafeInteger(amount)) return '';
  const currency = String(details.subjectSection ?? '') === 'egyptian_deposits' ? uiText("ج.م") : uiText("د.ل");
  return uiText("بقيمة {0} {1}", [amounts.format(amount), currency]);
}

function actorText(item: NotificationItem) {
  return `${item.actorRole === 'admin' ? uiText("الإداري") : uiText("الموظف")} ${item.actorName}`;
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
  const itemText = label && ![uiText("تسديد"), uiText("مستهلك فودافون"), uiText("تسديد واستهلاك فودافون")].includes(label)
    ? ` (${label})` : '';
  const parts: string[] = [];

  if (result !== 0) parts.push(uiText("شراء{0} بقيمة {1} د.ل", [itemText, amounts.format(result)]));
  if (paid !== 0) parts.push(uiText("تسديد {0} د.ل", [amounts.format(paid)]));
  if (consumed !== 0) parts.push(uiText("استهلاك فودافون {0} ج.م", [amounts.format(consumed)]));

  if (parts.length === 0) {
    return uiText("{0} سجّل معاملة مشتريات بدون قيمة مالية.", [actor]);
  }
  return uiText("{0} سجّل {1}.", [actor, parts.join(uiText("، "))]);
}

function payrollSentence(item: NotificationItem, actor: string) {
  const details = item.details;
  const amount = integerDetail(details, 'amountUnits');
  const kind = String(details.payrollKind ?? '');
  const employee = typeof details.employeeName === 'string' ? details.employeeName.trim() : '';
  const reason = typeof details.reason === 'string' ? details.reason.trim() : '';
  const target = employee ? uiText(" للموظف {0}", [employee]) : '';
  const label = kind === 'commission' ? uiText("عمولة أو مكافأة") : uiText("سحب");
  if (item.action === 'collection.payroll.entry.confirm') {
    return uiText("{0} أكد استلام {1} بقيمة {2} د.ل{3}.", [actor, label, amounts.format(amount), reason ? uiText(" بسبب {0}", [reason]) : '']);
  }
  if (item.action === 'collection.payroll.salary.update') {
    return uiText("{0} حدّث المرتب الثابت{1} إلى {2} د.ل.", [actor, target, amounts.format(amount)]);
  }
  return uiText("{0} أضاف {1}{2} بقيمة {3} د.ل{4}.", [actor, label, target, amounts.format(amount), reason ? uiText(" بسبب {0}", [reason]) : '']);
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
    const mode = paymentMode === 'full' ? uiText("تسديدًا كليًا") : uiText("تسديدًا جزئيًا");
    return uiText("{0} سجّل {1}{2}.", [actor, mode, suffix ? ` ${suffix}` : '']);
  }
  if (item.action === 'collection.unlinked.submit') {
    return uiText("{0} سجّل استلامًا غير مربوط{1} وينتظر ربط الإدارة.", [actor, suffix ? ` ${suffix}` : '']);
  }
  if (item.action.endsWith('.payment')) {
    const mode = paymentMode === 'full' ? uiText("تسديدًا كليًا") : uiText("تسديدًا جزئيًا");
    return uiText("{0} سجّل {1}{2}.", [actor, mode, suffix ? ` ${suffix}` : '']);
  }
  if (item.action.endsWith('.debt')) {
    return uiText("{0} أضاف دينًا{1}.", [actor, suffix ? ` ${suffix}` : '']);
  }
  if (item.action.endsWith('.create')) {
    return uiText("{0} نفّذ «{1}»{2}.", [actor, auditActionLabel(item.action), suffix ? ` ${suffix}` : '']);
  }
  if (item.action.endsWith('.update')) {
    return uiText("{0} عدّل {1}{2}.", [actor, subject || auditActionLabel(item.action), amount ? ` ${amount}` : '']);
  }
  if (item.action.endsWith('.cancel')) {
    return uiText("{0} ألغى معاملة {1}.", [actor, subject || '']).replace(/\s+\./u, '.');
  }
  if (item.action === 'collection.assign') {
    const count = Array.isArray(item.details.customerIds) ? item.details.customerIds.length : 0;
    return uiText("{0} وجّه {1} {2} للتحصيل.", [actor, count || '', count === 1 ? uiText("كارت") : uiText("كروت")]).replace(/\s+/g, ' ');
  }
  return uiText("{0} نفّذ «{1}»{2}.", [actor, auditActionLabel(item.action), suffix ? ` ${suffix}` : '']);
}
