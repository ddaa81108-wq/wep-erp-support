import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { cockpitPreviewFixture } from './helpers/cockpitPreviewFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

const { db, admin, collector, ledgerAccounts } = cockpitPreviewFixture();
const financialState = () => Object.fromEntries(['debt_transactions', 'treasury_cash_entries', 'purchase_entries', 'masraweya_days', 'masraweya_entries'].map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]));
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false, pushPublicKey: '', pushPrivateKey: '' }));
const browser = await chromium.launch();
const output = 'artifacts/cockpit-system'; mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 1080 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'abdo_session', value: createSession(db, admin.id, '1', 12).token, url: base }]);
  const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(`${r.method()} ${r.url()}`); });
  await page.goto(base + '/erp');
  const toggle = page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true });
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-royal-shell', 'cockpit');
  const before = financialState();
  const sections = [
    ['collections', 'قسم استلامات الديون', '.collection-board', '.collection-board-summary'],
    ['purchases', 'قسم المشتريات', '.purchase-action-dock', '.purchase-metrics'],
    ['masraweya', 'صفحة المصراوية', '.masraweya-header', '.masraweya-summary'],
    ['treasury', 'الخزينة', '.treasury-panel-head', '.treasury-cards'],
    ['reports', 'التقارير الذكية', '.financial-overview-head', '[data-testid="report-net"]'],
    ['settings', 'الإعدادات', '.settings-topbar', '.settings-topbar'],
  ];
  async function settle() { await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); }); }
  for (const [name, title, ready, metrics] of sections) {
    await page.setViewportSize({ width: 1600, height: 1080 });
    await page.locator('.sidebar nav').getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator(ready).first()).toBeVisible({ timeout: 20000 });
    const numbers = await page.locator(metrics).allTextContents();
    for (const theme of ['light', 'dark']) for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      await settle();
      assert.deepEqual(await page.locator(metrics).allTextContents(), numbers, `${name}: values unchanged`);
      const ink = theme === 'dark' ? 'rgb(242, 240, 232)' : 'rgb(23, 38, 59)';
      if (name === 'reports') assert.equal(await page.getByTestId('report-closing-net').evaluate(el => getComputedStyle(el).color), ink, '5AM comparison remains readable');
      if (name === 'masraweya') assert.ok(await page.locator('.masraweya-summary-sheet tr:not(.final-row)>td').evaluateAll((nodes, ink) => nodes.every(el => getComputedStyle(el).color === ink), ink), 'Summary numbers have matching day/night ink');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `${name}/${theme}/${width}: outer overflow`);
      await page.screenshot({ path: `${output}/${name}-${theme}-${width}.png` });
    }
    if (name === 'collections') {
      await page.setViewportSize({ width: 1600, height: 1080 });
      await page.getByRole('button', { name: 'المرتبات', exact: true }).click();
      await expect(page.locator('.payroll-metrics')).toBeVisible();
      await page.locator('.payroll-employee-picker select').selectOption(collector.id);
      const payrollValues = await page.locator('.payroll-metrics').textContent();
      for (const theme of ['light', 'dark']) for (const width of [1600, 390]) {
        await page.setViewportSize({ width, height: 1080 });
        await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
        await settle();
        assert.equal(await page.locator('.payroll-metrics').textContent(), payrollValues);
        await expect(page.locator('.cancel-payroll-entry')).toHaveCount(2);
        await page.screenshot({ path: `${output}/payroll-${theme}-${width}.png` });
      }
    }
    console.log(`PASS section ${name}: day/night, desktop/phone, unchanged displayed values.`);
  }
  const sectionNames = { customer_debts: 'قسم ديون العملاء', company_debts: 'قسم ديون الشركات', libyan_deposits: 'أمانات ليبية', egyptian_deposits: 'أمانات مصرية' };
  for (const account of ledgerAccounts) {
    const section = account.section_key as keyof typeof sectionNames;
    await page.setViewportSize({ width: 1600, height: 1080 });
    await page.locator('.sidebar nav').getByRole('button', { name: sectionNames[section], exact: true }).click();
    await page.locator(`[data-customer-id="${account.id}"] .customer-card-main`).click();
    const panel = page.locator('.ledger-panel'); await expect(panel).toBeVisible();
    const recordValues = () => panel.locator('.ledger-record').allTextContents();
    const totalStyle = () => panel.locator('.ledger-total').evaluate(el => ({ text: el.textContent, image: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).color }));
    const palette = () => panel.locator('.ledger-choice,.row-action,.ledger-record-pill').evaluateAll(nodes => nodes.map(el => ({ class: el.className, bg: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).color })));
    for (const theme of ['light', 'dark']) for (const width of [1600, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      await page.evaluate(value => { document.documentElement.dataset.theme = value; delete document.documentElement.dataset.royalShell; }, theme);
      await settle();
      const originalTotal = await totalStyle(), originalValues = await recordValues(), originalPalette = await palette();
      await page.evaluate(() => { document.documentElement.dataset.royalShell = 'cockpit'; });
      await settle();
      assert.deepEqual(await recordValues(), originalValues);
      assert.deepEqual(await totalStyle(), originalTotal, `${section}: balance wording and account colors`);
      assert.deepEqual(await palette(), originalPalette, `${section}: financial action palette`);
      assert.equal(await panel.locator(':scope>header').evaluate(el => getComputedStyle(el).backgroundColor), theme === 'dark' ? 'rgb(11, 23, 41)' : 'rgb(16, 35, 62)', 'Ledger masthead remains navy');
      await expect(panel.getByLabel('قيمة المعاملة', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'إغلاق السجل', exact: true })).toBeVisible();
      await page.screenshot({ path: `${output}/ledger-${section}-${theme}-${width}.png` });
      if (width === 1600) {
        const footer = await panel.locator('.ledger-footer-grid').boundingBox();
        await page.screenshot({ path: `${output}/ledger-${section}-${theme}-detail.png`, clip: { x: 0, y: 0, width: 1600, height: Math.min(1080, Math.ceil((footer?.y ?? 500) + (footer?.height ?? 80) + 20)) } });
      }
    }
    await panel.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
    console.log(`PASS ledger ${section}: unchanged amounts, totals, record data and financial choice/action colors.`);
  }
  assert.deepEqual(financialState(), before);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  console.log('PASS: remaining six sections + payroll + four internal ledgers, 44 theme/viewport states. Zero financial writes; synthetic DB only.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
