import { uiText, displayLocale } from '../../i18n/language.ts';
const movementDate = new Intl.DateTimeFormat(displayLocale, {
  timeZone: 'Africa/Tripoli', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
});
const recordedTime = new Intl.DateTimeFormat(displayLocale, {
  timeZone: 'Africa/Tripoli', hour: 'numeric', minute: '2-digit',
});
const recordedDateTime = new Intl.DateTimeFormat(displayLocale, {
  timeZone: 'Africa/Tripoli', dateStyle: 'full', timeStyle: 'short',
});
export function ledgerDisplayDates(transactionDate: string, createdAt: string) {
  const parts = movementDate.formatToParts(new Date(transactionDate));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value ?? '';
  const recorded = new Date(createdAt);
  const valid = Number.isFinite(recorded.getTime());
  return {
    weekday: part('weekday'),
    date: `${part('day')}/${part('month')}/${part('year')}`,
    time: valid ? recordedTime.format(recorded) : uiText("غير متاح"),
    recordingTitle: valid ? uiText("وقت التسجيل بتوقيت ليبيا: {0}", [recordedDateTime.format(recorded)]) : uiText("وقت التسجيل غير متاح"),
  };
}
