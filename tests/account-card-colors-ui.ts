import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, accounts } = accountCardFixture();
const balances = () => db.prepare('SELECT id,current_balance_units,ledger_next_sequence FROM customers ORDER BY id').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const before = balances();
const browser = await chromium.launch({ headless: true });
const output = 'artifacts/account-card-colors';
mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  const errors: string[] = [];
  const financialWrites: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!['GET', 'HEAD'].includes(request.method()) && /\/api\/(customers|companies|deposits)\b/.test(request.url())) financialWrites.push(request.url());
  });
  await page.goto(base + '/erp');
  const sections = [
    ['customers', 'قسم ديون العملاء'], ['companies', 'قسم ديون الشركات'],
    ['libyan-deposits', 'أمانات ليبية'], ['egyptian-deposits', 'أمانات مصرية'],
  ] as const;
  const palette = { system: 'rgb(189, 59, 71)', customer: 'rgb(33, 158, 109)', zero: 'rgb(52, 52, 52)' };
  const labels: Record<string, string[]> = {
    customers: ['دين جديد', 'مرّ عليه 3 أيام', 'دين متأخر', 'أمانة', 'حساب صفر'],
    companies: ['دين جديد', 'مرّ عليه 3 أيام', 'دين متأخر', 'أمانة', 'حساب صفر'],
    'libyan-deposits': ['أمانة للعميل', 'دين على العميل', 'حساب صفر'],
    'egyptian-deposits': ['لصالح المنظومة — دين على العميل', 'دين علينا للعميل', 'حساب صفر', 'مرتبط تلقائيًا'],
  };
  for (const [section, title] of sections) {
    await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
    const cards = page.locator('.customer-card');
    await expect(page.locator('.customer-name-line').getByText(accounts.find(account => account.section === section)!.name, { exact: true })).toBeVisible();
    const systemAccounts = section === 'egyptian-deposits' ? 2 : 0;
    await expect(cards).toHaveCount(72 + systemAccounts);
    for (const owner of ['system', 'customer', 'zero'])
      await expect(page.locator(`.customer-card[data-balance-owner="${owner}"]`)).toHaveCount(24 + (owner === 'zero' ? systemAccounts : 0));
    const namesBefore = await cards.locator('.customer-name-line').allTextContents();
    const amountsBefore = await cards.locator('.customer-balance-amount').allTextContents();
    const cardLabels = await cards.locator('.customer-card-label').allTextContents();
    assert.deepEqual([...new Set(cardLabels)].sort(), [...labels[section]].sort());
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const appearance = await cards.evaluateAll(elements => elements.map(element => ({
          owner: element.getAttribute('data-balance-owner'),
          background: getComputedStyle(element).backgroundImage,
        })));
        const sectionPalette = section === 'egyptian-deposits' ? { system: palette.customer, customer: palette.system, zero: palette.zero } : palette;
        for (const card of appearance) assert.ok(card.background.includes(sectionPalette[card.owner as keyof typeof palette]), `${section}/${theme}/${width}: ${card.owner}: ${card.background}`);
        assert.deepEqual(await cards.locator('.customer-name-line').allTextContents(), namesBefore);
        assert.deepEqual(await cards.locator('.customer-balance-amount').allTextContents(), amountsBefore);
        assert.deepEqual(await cards.locator('.customer-card-label').allTextContents(), cardLabels);
        await page.screenshot({ path: `${output}/${section}-${theme}-${width}.png`, fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const sample of accounts.filter(account => account.section === section).slice(0, 3)) {
      const card = cards.filter({ has: page.locator('.customer-name-line').getByText(sample.name, { exact: true }) });
      await expect(card).toHaveAttribute('data-balance-owner', sample.owner);
    }
    if (section === 'customers' || section === 'companies') {
      await expect(page.locator('.debt-ticker')).toContainText('منذ');
      await expect(page.locator('.debt-ticker')).toContainText('أيام');
      assert.ok(await cards.filter({ has: page.locator('.customer-card-label').getByText('دين جديد', { exact: true }) }).count());
      assert.ok(await cards.filter({ has: page.locator('.customer-card-label').getByText('دين متأخر', { exact: true }) }).count());
    }
    console.log(`PASS ${section}: ${72 + systemAccounts} cards, section-specific debt/trust signs, 3 fixed colors, original labels and values, 2 themes, desktop/mobile.`);
  }
  assert.deepEqual(balances(), before);
  assert.deepEqual(financialWrites, []);
  assert.deepEqual(errors, []);
  console.log('PASS: 288 test accounts and 2 automatic accounts checked; financial balances and sequences unchanged; no financial writes.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
}
