import type { AppDatabase } from '../../db/database.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();
const ranges = new Map<string, { start: string; end: string }>();

export function currentBusinessDate(date = new Date(), timezone = 'Africa/Tripoli') {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timezone, formatter);
  }
  return formatter.format(date);
}

export function organizationTimezone(database: AppDatabase, organizationId: string) {
  const row = database
    .prepare('SELECT timezone FROM organization_settings WHERE organization_id=?')
    .get(organizationId) as { timezone: string } | undefined;
  return row?.timezone ?? 'Africa/Tripoli';
}

export function organizationBusinessDate(database: AppDatabase, organizationId: string) {
  return currentBusinessDate(new Date(), organizationTimezone(database, organizationId));
}

/** Find the first instant of each local day, including 23/25-hour DST days. */
export function businessDayRange(day: string, timezone: string) {
  const key = `${timezone}:${day}`;
  const cached = ranges.get(key);
  if (cached) return cached;
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(midnight) ||
    new Date(midnight).toISOString().slice(0, 10) !== day
  )
    throw new Error('Invalid business date');
  const boundary = (target: string, approximate: number) => {
    let low = approximate - 36 * 3_600_000;
    let high = approximate + 36 * 3_600_000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (currentBusinessDate(new Date(middle), timezone) < target) low = middle + 1;
      else high = middle;
    }
    return new Date(low).toISOString();
  };
  const next = midnight + 86_400_000;
  const result = {
    start: boundary(day, midnight),
    end: boundary(new Date(next).toISOString().slice(0, 10), next),
  };
  if (ranges.size >= 256) ranges.clear();
  ranges.set(key, result);
  return result;
}
