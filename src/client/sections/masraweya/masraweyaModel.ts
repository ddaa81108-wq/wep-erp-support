import { uiText } from '../../i18n/language.ts';
import type { MasraweyaDay } from '../../apiTypes/masraweya.ts';

export function masraweyaAccessState(day: Partial<MasraweyaDay> | null, canWrite: boolean, loading: boolean) {
  const incompatible = Boolean(
    day &&
    (typeof day.editable !== 'boolean' ||
      typeof day.today !== 'string' ||
      typeof day.earliestEditableDate !== 'string' ||
      typeof day.openingEditable !== 'boolean'),
  );
  const locked = loading || !day || incompatible || !canWrite || !day.editable;
  const accessLabel = loading
    ? uiText("جارٍ تحميل اليوم…")
    : incompatible
      ? uiText("نسخة الخادم تحتاج تحديثًا")
      : !canWrite
        ? uiText("لا توجد صلاحية كتابة")
        : !day?.editable
          ? uiText("للقراءة فقط")
          : day.businessDate === day.today
            ? uiText("يوم العمل الحالي")
            : uiText("تعديل يوم سابق");
  return { locked, incompatible, accessLabel };
}

export type MasraweyaEntryDraft = { value: string; commission: string };

export const masraweyaNumberFormat = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

export function englishInteger(value: string) {
  return value.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
}

export function numberValue(value: string) {
  return Number(value || 0);
}

export function blankMasraweyaRows(count = 4): MasraweyaEntryDraft[] {
  return Array.from({ length: count }, () => ({ value: '', commission: '' }));
}

export function masraweyaTotals(rows: MasraweyaEntryDraft[], previous: string, purchases: string) {
  const workTotal = rows.reduce((sum, row) => sum + numberValue(row.value) + numberValue(row.commission), 0);
  const final = numberValue(previous) + numberValue(purchases) - workTotal;
  return { workTotal, final };
}

export function masraweyaGridNavigation(key: string, row: number, column: number, rowCount: number) {
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(key)) return null;
  let nextRow = row;
  let nextColumn = column;
  if (key === 'ArrowDown' || key === 'Enter') nextRow += 1;
  if (key === 'ArrowUp') nextRow = Math.max(0, row - 1);
  if (key === 'ArrowLeft') nextColumn = Math.min(1, column + 1);
  if (key === 'ArrowRight') nextColumn = Math.max(0, column - 1);
  return {
    row: nextRow,
    column: nextColumn,
    append: nextRow >= rowCount && (key === 'ArrowDown' || key === 'Enter'),
  };
}
