export function isValidCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

export function hasValidLeadingCalendarDate(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
  return !match || isValidCalendarDate(match[1]);
}
