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
