import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';

const database = openDatabase(':memory:');
const server = createApp(
  database,
  loadConfig({
    databasePath: ':memory:',
    publicOrigin: '',
    secureCookie: false,
    internetRequired: false,
    setupToken: '',
  }),
);
const browser = await chromium.launch();
const output = resolve('artifacts/languages');
mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const setup = await page.request.post(`${base}/api/setup/admin`, {
    data: { username: 'admin', displayName: 'مدير Test', password: 'Language Test 123!' },
  });
  assert.ok(setup.ok());
  const actor = fixtureAdmin(database);
  const name = 'محمد Global 123';
  createCustomer(database, actor, { requestId: 'language-customer', name, openingBalance: 123456 }, 'test');
  const before = database.prepare('SELECT * FROM customers ORDER BY id').all();
  await page.goto(`${base}/erp`);
  await expect(page.getByLabel('البريد الإلكتروني', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.screenshot({ path: resolve(output, 'login-ar.png'), fullPage: true });
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('unsaved-login');
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByLabel('البريد الإلكتروني', { exact: true })).toHaveValue('unsaved-login');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.screenshot({ path: resolve(output, 'login-en.png'), fullPage: true });
  await page.getByLabel('Email address', { exact: true }).fill('admin');
  await page.getByLabel('Password', { exact: true }).fill('Wrong password 123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Incorrect username or password.', { exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('Language Test 123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.customer-card-main').filter({ hasText: name })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.customer-card-main').filter({ hasText: name })).toBeVisible();
  assert.deepEqual(database.prepare('SELECT * FROM customers ORDER BY id').all(), before);
  for (const width of [1440, 1366, 390]) {
    await page.setViewportSize({ width, height: 950 });
    if (width < 901) {
      await expect
        .poll(() => page.locator('.sidebar').evaluate((node) => node.getBoundingClientRect().right <= 0))
        .toBe(true);
      await expect
        .poll(() => page.locator('.app-shell').evaluate((node) => getComputedStyle(node).paddingLeft))
        .toBe('0px');
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      .toBe(true);
    await page.screenshot({
      path: resolve(output, `customers-en-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.locator('.customer-card-main').filter({ hasText: name }).click();
  await expect(page.getByLabel('Transaction amount', { exact: true })).toBeFocused();
  await page.getByLabel('Transaction amount', { exact: true }).fill('789012');
  await page.getByLabel('Transaction note', { exact: true }).fill('ملاحظة عربية English');
  await page.getByRole('button', { name: 'Approve transaction', exact: true }).click();
  await expect(page.locator('.ledger-record').filter({ hasText: 'ملاحظة عربية English' })).toBeVisible();
  await page.screenshot({ path: resolve(output, 'ledger-en.png'), fullPage: true });
  const saved = database.prepare('SELECT * FROM customers ORDER BY id').all();
  assert.equal(saved[0].current_balance_units, 912468);
  await page.getByRole('button', { name: 'Close record', exact: true }).click();
  const sections = [
    ['Company debts', 'companies'],
    ['Libyan deposits', 'libyan-deposits'],
    ['Egyptian deposits', 'egyptian-deposits'],
    ['Debt collections', 'collections'],
    ['Masraweya', 'masraweya'],
    ['Purchases', 'purchases'],
    ['Treasury', 'treasury'],
    ['Smart reports', 'reports'],
    ['Settings', 'settings'],
  ];
  for (const [label, section] of sections) {
    await page.locator('.sidebar nav').getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator(`.workspace.active-section-${section}`)).toBeVisible();
    // Wait for lazy section loading to finish before measuring the real layout.
    await expect(page.getByText('Opening section…', { exact: true })).toHaveCount(0);
    await page.screenshot({
      path: resolve(output, `${section}-en.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() => page.locator('.app-shell').evaluate((node) => getComputedStyle(node).paddingLeft))
      .toBe('0px');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      .toBe(true);
    await page.screenshot({
      path: resolve(output, `${section}-en-mobile.png`),
      fullPage: true,
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1440, height: 950 });
  }
  await page.getByRole('button', { name: /Financial ledger/ }).click();
  await expect(page.getByRole('heading', { name: 'Financial ledger', exact: true })).toBeVisible();
  await expect(page.getByLabel('Filter section', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'التبديل إلى العربية', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.locator('.sidebar nav').getByRole('button', { name: 'قسم ديون العملاء', exact: true }).click();
  await expect(page.locator('.customer-card-main').filter({ hasText: name })).toBeVisible();
  assert.deepEqual(database.prepare('SELECT * FROM customers ORDER BY id').all(), saved);
  assert.deepEqual(errors, []);
  console.log(
    'PASS bilingual UI: Arabic/English login, localized API errors, persistent preference, desktop/mobile, all sections, financial entry and unchanged stored names/notes/balances after language switching.',
  );
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
}
