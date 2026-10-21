import type { DailyFinancialReport, ReportStatus } from '../../api.ts';

export const reportNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const statusText: Record<ReportStatus, string> = {
  normal: 'طبيعي',
  review: 'يحتاج مراجعة',
  critical: 'مراجعة فورية',
  missing_rate: 'سعر التحويل مفقود',
};

export function netChange(items: readonly DailyFinancialReport[], index: number) {
  const current = items[index]?.netUnits;
  const previous = items[index + 1]?.netUnits;
  return current === null || current === undefined || previous === null || previous === undefined
    ? null
    : current - previous;
}

export function money(value: number | null, currency = 'د.ل') {
  return value === null ? '—' : `${reportNumber.format(value)} ${currency}`;
}

export function closingText(closing: DailyFinancialReport['fiveAmClosing'] | undefined) {
  if (!closing) return 'يتطلب تحديث الخادم';
  if (closing.state === 'pending') return 'بانتظار الإقفال';
  if (closing.state === 'missed') return 'لم يُسجّل الإقفال';
  if (closing.state === 'missing_rate') return 'غير مكتمل — سعر التحويل مفقود';
  if (closing.netUnits === null) return 'غير مكتمل';
  const direction = closing.netUnits > 0 ? 'لنا' : closing.netUnits < 0 ? 'علينا' : 'متوازن';
  return `${money(Math.abs(closing.netUnits))} — ${direction}`;
}
