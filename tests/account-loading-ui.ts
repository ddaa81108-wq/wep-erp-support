import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin } = accountCardFixture(3);
const balances = db.prepare('SELECT id,current_balance_units FROM customers ORDER BY id').all();
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }),
);
const browser = await chromium.launch();
const releases: (() => void)[] = [];
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext();
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([
    { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const page = await context.newPage();
  let releaseCustomers!: () => void;
  const customerGate = new Promise<void>((resolve) => {
    releaseCustomers = resolve;
    releases.push(resolve);
  });
  let releaseCompanies!: () => void;
  const companyGate = new Promise<void>((resolve) => {
    releaseCompanies = resolve;
    releases.push(resolve);
  });
  let customerStarted = false,
    companyStarted = false;
  await page.route('**/api/customers?*', async (route) => {
    customerStarted = true;
    const response = await route.fetch();
    await customerGate;
    await route.fulfill({ response });
  });
  await page.route('**/api/companies?*', async (route) => {
    companyStarted = true;
    const response = await route.fetch();
    await companyGate;
    await route.fulfill({ response });
  });
  await page.goto(base + '/erp');
  await expect.poll(() => customerStarted).toBe(true);
  await page.locator('.sidebar').getByRole('button', { name: 'قسم ديون الشركات', exact: true }).click();
  await expect.poll(() => companyStarted).toBe(true);
  await expect(page.getByText('جارٍ تحميل الحسابات…', { exact: true })).toBeVisible();
  const obsoleteResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/customers',
  );
  releaseCustomers();
  // The obsolete customer's completion must not dismiss the company's loading state.
  await obsoleteResponse;
  await expect(page.getByText('لا توجد كروت في هذا العرض', { exact: true })).toHaveCount(0);
  await expect(page.getByText('جارٍ تحميل الحسابات…', { exact: true })).toBeVisible();
  releaseCompanies();
  await expect(page.locator('.customer-card').first()).toBeVisible();
  assert.ok(
    (await page.locator('.customer-name-line').allTextContents()).every((name) => name.includes('شركة')),
  );
  // A confirmed empty search is different from an unfinished/failed read.
  await page.locator('.dashboard-search input').fill('بحث تجريبي لا يطابق أي حساب');
  await expect(page.getByText('لا توجد نتائج', { exact: true })).toBeVisible();
  await page.unroute('**/api/customers?*');
  await page.route('**/api/customers?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: false,
        error: { code: 'TEST_READ_FAILURE', message: 'Synthetic read failure' },
      }),
    }),
  );
  await page.locator('.sidebar').getByRole('button', { name: 'قسم ديون العملاء', exact: true }).click();
  await expect(page.getByText('تعذر تحميل الحسابات. أعد المحاولة.', { exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText('لا توجد كروت في هذا العرض', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/customers?*');
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(page.locator('.customer-card').first()).toBeVisible();
  assert.ok(
    (await page.locator('.customer-name-line').allTextContents()).every((name) => name.includes('عميل')),
  );
  assert.deepEqual(db.prepare('SELECT id,current_balance_units FROM customers ORDER BY id').all(), balances);
  console.log(
    'PASS account loading: obsolete cross-section completion cannot show a false empty state or wrong-section cards.',
  );
} finally {
  releases.forEach((release) => release());
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
