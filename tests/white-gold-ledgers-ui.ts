import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, accounts } = accountCardFixture(12);
const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }));
const browser = await chromium.launch();
mkdirSync('artifacts/white-gold-ledgers', { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([{ name: 'abdo_session', value: createSession(db, admin.id, '1', 12).token, url: base }]);
  const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  await page.goto(base + '/erp');
  for (const [section, title] of [['customers', 'قسم ديون العملاء'], ['companies', 'قسم ديون الشركات'], ['libyan-deposits', 'أمانات ليبية'], ['egyptian-deposits', 'أمانات مصرية']]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.sidebar nav').getByRole('button', { name: title, exact: true }).click();
    const target = accounts.find(account => account.section === section && account.balance > 0)!;
    await page.locator('.customer-card-main').filter({ hasText: target.name }).click();
    const panel = page.locator('.ledger-panel');
    await expect(panel).toBeVisible();
    const total = panel.locator('.ledger-total');
    for (const theme of ['light', 'dark']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; delete document.documentElement.dataset.royalShell; }, theme);
        await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
        const baseline = await total.evaluate(element => ({ text: element.textContent, background: getComputedStyle(element).backgroundImage, color: getComputedStyle(element).color }));
        const controls = panel.locator('.ledger-choice,.row-action,.ledger-record-pill');
        const palette = () => controls.evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          return { classes: element.className, background: style.backgroundColor, image: style.backgroundImage,
            color: style.color, border: style.borderColor, opacity: style.opacity };
        }));
        const originalPalette = await palette();
        if (section === 'customers' && theme === 'light' && width === 1440)
          await page.screenshot({ path: 'artifacts/white-gold-ledgers/original-buttons.png' });
        await page.evaluate(() => { document.documentElement.dataset.royalShell = '03'; });
        await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
        const themedPalette = await palette();
        if (JSON.stringify(themedPalette) !== JSON.stringify(originalPalette))
          await page.screenshot({ path: 'artifacts/white-gold-ledgers/buttons-before-fix.png' });
        assert.deepEqual(themedPalette, originalPalette, `${section}/${theme}/${width}: preserve original financial control colors`);
        if (section === 'customers' && theme === 'light' && width === 1440) {
          await page.setViewportSize({ width: 1600, height: 1000 });
          await page.screenshot({ path: 'artifacts/white-gold-ledgers/buttons-after-fix.png', clip: { x: 0, y: 0, width: 1600, height: 310 } });
          await page.setViewportSize({ width, height: 1000 });
        }
        const actual = await total.evaluate(element => ({ text: element.textContent, background: getComputedStyle(element).backgroundImage, color: getComputedStyle(element).color }));
        assert.deepEqual(actual, baseline, `${section}: financial total remains unchanged`);
        await expect(panel.getByRole('button', { name: 'إغلاق السجل', exact: true })).toBeVisible();
        await expect(panel.getByLabel('قيمة المعاملة', { exact: true })).toBeVisible();
        await page.screenshot({ path: `artifacts/white-gold-ledgers/${section}-${theme}-${width}.png` });
      }
    }
    await panel.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
  }
  assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(), before);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS: all four ledgers, 16 phone/desktop/theme states; original button/pill palettes, total colors, amounts, inputs and zero financial writes.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
