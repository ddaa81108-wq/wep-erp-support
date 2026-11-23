import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { addTreasuryCashEntry } from '../src/server/domain/treasury.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const db = openDatabase(':memory:'), admin = fixtureAdmin(db);
for (let i = 0; i < 135; i++) addTreasuryCashEntry(db, admin, {
  requestId: `white-gold-${i}`, expectedVersion: i, direction: i % 3 ? 'in' : 'out',
  amountUnits: i % 3 ? 200 : 50, description: `حركة اختبار ${i + 1}`,
}, 'test');
const before = db.prepare('SELECT * FROM treasury_cash_entries ORDER BY sequence').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const browser = await chromium.launch();
const errors: string[] = [], writes: string[] = [];
mkdirSync('artifacts/white-gold-treasury', { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await context.addCookies([{ name: 'abdo_session', value: createSession(db, admin.id, '1', 12).token, url: base }]);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'الخزينة', exact: true }).click();
  const ledger = page.locator('.treasury-ledger');
  await expect(ledger.locator('[data-sequence]')).toHaveCount(100);
  const summary = await page.locator('.treasury-cards').textContent();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [1440, 1024, 390, 360]) {
      await page.setViewportSize({ width, height: 950 });
      await expect.poll(() => ledger.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 3)).toBe(true);
      const bounds = await page.evaluate(() => {
        const ledger = document.querySelector('.treasury-ledger')!.getBoundingClientRect();
        const head = document.querySelector('.treasury-ledger-row.head')!.getBoundingClientRect();
        const cards = document.querySelector('.treasury-cards')!.getBoundingClientRect();
        const actions = document.querySelector('.treasury-panel-head')!.getBoundingClientRect();
        return { height: ledger.height, headOffset: head.top - ledger.top, cardsTop: cards.top, ledgerBottom: ledger.bottom, actionsTop: actions.top, overflow: document.documentElement.scrollWidth > innerWidth + 2 };
      });
      assert.ok(bounds.height >= 200, JSON.stringify(bounds));
      assert.ok(Math.abs(bounds.headOffset) <= 2, 'Column header stays at viewport top while newest rows are visible');
      assert.ok(bounds.cardsTop >= bounds.ledgerBottom && Math.abs(bounds.actionsTop - bounds.cardsTop) <= 2);
      assert.equal(bounds.overflow, false);
      assert.equal(await page.locator('.treasury-cards').textContent(), summary);
      await expect(page.locator('.treasury-cash-actions')).toBeInViewport();
      await page.screenshot({ path: `artifacts/white-gold-treasury/${theme}-${width}.png` });
    }
  }
  await page.getByRole('button', { name: 'تحميل حركات أقدم', exact: true }).click();
  await expect(ledger.locator('[data-sequence]')).toHaveCount(135);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await expect(page.locator('.treasury-entry-form')).toBeVisible();
  await page.locator('.treasury-entry-form').getByRole('button', { name: 'إلغاء', exact: true }).click();
  await ledger.getByRole('button', { name: 'تعديل المعاملة 135', exact: true }).click();
  const correction = page.locator('.treasury-inline-edit');
  const save = correction.getByRole('button', { name: 'حفظ التعديل', exact: true });
  await expect(save).toBeDisabled();
  await correction.getByLabel('القيمة الصحيحة', { exact: true }).fill('201');
  await expect(save).toBeEnabled();
  const savePalette = () => save.evaluate(button => {
    const style = getComputedStyle(button);
    return { background: style.backgroundColor, image: style.backgroundImage, color: style.color, border: style.borderColor };
  });
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; delete document.documentElement.dataset.royalShell; }, theme);
      const original = await savePalette();
      await page.evaluate(() => { document.documentElement.dataset.royalShell = '03'; });
      assert.deepEqual(await savePalette(), original, `treasury/${theme}/${width}: original green save action`);
      await page.screenshot({ path: `artifacts/white-gold-treasury/save-${theme}-${width}.png` });
    }
  }
  page.once('dialog', dialog => void dialog.accept());
  await correction.getByRole('button', { name: 'إلغاء التعديل', exact: true }).click();
  assert.deepEqual(db.prepare('SELECT * FROM treasury_cash_entries ORDER BY sequence').all(), before);
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log('PASS: 8 treasury layouts and 4 original green save-button states; sticky header, older history, unchanged summaries and no writes.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
