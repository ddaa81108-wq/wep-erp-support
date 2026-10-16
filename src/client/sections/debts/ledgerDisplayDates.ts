/** Display only: never changes the accounting transaction date or stored timestamps. */
const movementDate = new Intl.DateTimeFormat('ar-LY', {
  timeZone: 'Africa/Tripoli', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
});
const recordedTime = new Intl.DateTimeFormat('ar-LY', {
  timeZone: 'Africa/Tripoli', hour: 'numeric', minute: '2-digit',
});
const recordedDateTime = new Intl.DateTimeFormat('ar-LY', {
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
    time: valid ? recordedTime.format(recorded) : 'غير متاح',
    recordingTitle: valid ? `وقت التسجيل بتوقيت ليبيا: ${recordedDateTime.format(recorded)}` : 'وقت التسجيل غير متاح',
  };
}
