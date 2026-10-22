import { uiText } from '../../i18n/language.ts';
import type { DailyFinancialReport, ReportStatus } from '../../api.ts';

export const reportNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export const statusText: Record<ReportStatus, string> = {
  normal: uiText("طبيعي"),
  review: uiText("يحتاج مراجعة"),
  critical: uiText("مراجعة فورية"),
  missing_rate: uiText("سعر التحويل مفقود"),
};

export function netChange(items: readonly DailyFinancialReport[], index: number) {
  const current = items[index]?.netUnits;
  const previous = items[index + 1]?.netUnits;
  return current === null || current === undefined || previous === null || previous === undefined
    ? null
    : current - previous;
}

/** Localizes only the system analysis; account names and user notes stay intact. */
export function reportSummary(item: DailyFinancialReport) {
  return uiText(item.summary);
}

export function money(value: number | null, currency = uiText("د.ل")) {
  return value === null ? '—' : `${reportNumber.format(value)} ${currency}`;
}

export function closingText(closing: DailyFinancialReport['fiveAmClosing'] | undefined) {
  if (!closing) return uiText("يتطلب تحديث الخادم");
  if (closing.state === 'pending') return uiText("بانتظار الإقفال");
  if (closing.state === 'missed') return uiText("لم يُسجّل الإقفال");
  if (closing.state === 'missing_rate') return uiText("غير مكتمل — سعر التحويل مفقود");
  if (closing.netUnits === null) return uiText("غير مكتمل");
  const direction = closing.netUnits > 0 ? uiText("لنا") : closing.netUnits < 0 ? uiText("علينا") : uiText("متوازن");
  return `${money(Math.abs(closing.netUnits))} — ${direction}`;
}
