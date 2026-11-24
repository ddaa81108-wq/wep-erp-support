import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionAppearanceFixture } from './helpers/collectionAppearanceFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

const { db, admin, collector, other } = collectionAppearanceFixture();
const state = () => ['customers', 'debt_transactions', 'debt_assignments', 'collection_submissions', 'treasury_cash_entries'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
const before = state();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false, pushPublicKey: '', pushPrivateKey: '' }));
const browser = await chromium.launch();
const output = 'artifacts/collection-appearance-colors'; mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const errors: string[] = [], writes: string[] = [];
  for (const actor of [admin, collector, other]) {
    const context = await browser.newContext({ viewport: { width: actor.role === 'admin' ? 1540 : 390, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: 'abdo_session', value: createSession(db, actor.id, 'test', 12).token, url: base }]);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + new URL(request.url()).pathname); });
    await page.goto(base + '/erp');
    if (actor.role === 'admin') await page.locator('.sidebar nav').getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
    const cards = page.locator(actor.role === 'admin' ? '.board-assignment' : '.employee-collection-board .collection-card');
    await expect(cards.first()).toBeVisible();
    const toggle = page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true });
    async function appearance(value: string) {
      const viewport = page.viewportSize()!;
      // The phone drawer is intentionally closed. Use the visible desktop
      // appearance control, then return to the viewport being checked.
      if (viewport.width <= 900) await page.setViewportSize({ width: 1540, height: viewport.height });
      for (let count = 0; count < 3 && await toggle.getAttribute('data-appearance') !== value; count++) await toggle.click();
      await expect(toggle).toHaveAttribute('data-appearance', value);
      if (viewport.width <= 900) await page.setViewportSize(viewport);
      await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    }
    const palette = () => cards.evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node);
      return { text: node.textContent, tone: [...node.classList].filter(value => value.startsWith('collection-') || value === 'zero-collection-card'),
        background: style.backgroundImage, backgroundColor: style.backgroundColor, color: style.color, border: style.borderColor,
        labels: [...node.querySelectorAll('header strong,.collection-name,.collection-balance,.collection-card-amounts bdi')].map(label => ({ text: label.textContent, color: getComputedStyle(label).color })),
      };
    }));
    for (const theme of ['light', 'dark']) for (const width of actor.role === 'admin' ? [1540, 390] : [390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await appearance('original'); const original = await palette();
      if (actor.role === 'admin') assert.equal(new Set(original.flatMap(row => row.tone)).size, 6);
      for (const value of ['03', 'cockpit']) {
        await appearance(value);
        assert.deepEqual(await palette(), original, `${actor.id}/${theme}/${width}/${value}: original account card data, status and colors`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
        await page.screenshot({ path: `${output}/${actor.role === 'admin' ? 'admin' : actor.id}-${value}-${theme}-${width}.png`, fullPage: true });
      }
    }
    await context.close();
  }
  assert.deepEqual(state(), before); assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS: original six account states, admin and employees, two new appearances, light/dark, desktop/phone; no financial writes or new rejected-receipt cards.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
