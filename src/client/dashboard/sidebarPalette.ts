export const SIDEBAR_PALETTES = ['gold', 'blue', 'red', 'orange', 'green', 'black'] as const;
const libyaClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Tripoli', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function sidebarPaletteAt(date: Date) {
  const parts = libyaClock.formatToParts(date);
  const part = (key: Intl.DateTimeFormatPartTypes) => Number(parts.find(p => p.type === key)?.value);
  const day = Date.UTC(part('year'), part('month') - 1, part('day'));
  const elapsed = Math.round((day - Date.UTC(2026, 9, 15)) / 86_400_000);
  return {
    palette: SIDEBAR_PALETTES[((elapsed % 6) + 6) % 6],
    untilMidnight: 86_400_000 - ((part('hour') * 3600 + part('minute') * 60 + part('second')) * 1000 + date.getMilliseconds()),
  };
}
