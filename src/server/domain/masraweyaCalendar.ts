import { currentBusinessDate } from './reports/businessDates.ts';
import { isValidCalendarDate } from './dates.ts';
import { badRequest } from '../http/errors.ts';

export function masraweyaToday(now = new Date()) {
  return currentBusinessDate(new Date(now.getTime() - 4 * 3_600_000), 'Africa/Tripoli');
}

export function masraweyaDate(value?: unknown) {
  const date = value === undefined || value === '' ? masraweyaToday() : String(value);
  if (!isValidCalendarDate(date)) throw badRequest('INVALID_BUSINESS_DATE', 'تاريخ صفحة المصراوية غير صالح.');
  return date;
}

export function masraweyaEditWindow(date: string) {
  const today = masraweyaToday();
  const earliest = new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
  return { today, earliestEditableDate: earliest, editable: date >= earliest && date <= today };
}
