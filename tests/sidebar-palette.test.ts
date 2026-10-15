import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sidebarPaletteAt, SIDEBAR_PALETTES } from '../src/client/dashboard/sidebarPalette.ts';

test('sidebar colors follow Libya midnight and repeat every six days', () => {
  const start = Date.parse('2026-10-14T22:00:00Z');
  for (let day = 0; day < 18; day++) {
    const result = sidebarPaletteAt(new Date(start + day * 86_400_000));
    assert.equal(result.palette, SIDEBAR_PALETTES[day % 6]);
    assert.equal(result.untilMidnight, 86_400_000);
  }
  assert.equal(sidebarPaletteAt(new Date('2026-10-15T21:59:59.999Z')).palette, 'gold');
  assert.equal(sidebarPaletteAt(new Date('2026-10-15T21:59:59.999Z')).untilMidnight, 1);
  assert.equal(sidebarPaletteAt(new Date('2026-10-15T22:00:00Z')).palette, 'blue');
  assert.equal(sidebarPaletteAt(new Date('2026-10-15T18:00:00-04:00')).palette, 'blue');
});
