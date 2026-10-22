import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { loadConfig } from '../src/server/config.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { createSession } from '../src/server/security/sessions.ts';

const database = openDatabase(':memory:');
const actor = fixtureAdmin(database);
createCustomer(database, actor, { name: 'عميل اختبار الأداء', openingBalance: 100, requestId: 'performance-customer' }, 'test');
const server = createApp(database, loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }));
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const session = createSession(database, actor.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/erp`);
  await expect(page.locator('.customer-card-main').first()).toBeVisible({ timeout: 20_000 });
  const navigate = (name: string) => page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click();
  const amount = page.getByLabel('القيمة في الصف 1', { exact: true });
  for (const cached of [false, true]) {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    await page.route('**/api/masraweya/day*', async route => {
      if (route.request().method() === 'GET') { intercepted = true; await held; }
      await route.continue();
    });
    await navigate('صفحة المصراوية');
    await expect.poll(() => intercepted).toBe(true);
    if (cached) {
      await expect(amount).toBeVisible();
      await expect(amount).toBeDisabled();
    } else {
      await expect(page.locator('.masraweya-page .empty')).toContainText('جارٍ تحميل المصراوية…');
    }
    await expect(page.getByRole('button', { name: 'إعادة المحاولة', exact: true })).toHaveCount(0);
    release();
    await expect(amount).toBeEnabled();
    await page.unroute('**/api/masraweya/day*');
    await navigate('الخزينة');
    await expect(page.locator('.treasury-page')).toBeVisible();
  }
  // A failed validation must leave the cached financial form locked, and retry reads again.
  await page.route('**/api/masraweya/day*', route => route.abort());
  await navigate('صفحة المصراوية');
  await expect(page.locator('.masraweya-page .alert.error')).toBeVisible();
  await expect(amount).toBeDisabled();
  await page.unroute('**/api/masraweya/day*');
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(amount).toBeEnabled();
  await navigate('قسم ديون العملاء');
  await page.locator('.customer-card-main').first().click();
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toBeVisible();
  // Reads fail after opening the ledger; a committed response must still appear once.
  await page.route('**/api/customers**', async route => {
    if (route.request().method() === 'GET') await route.abort();
    else await route.continue();
  });
  await page.getByLabel('قيمة المعاملة', { exact: true }).fill('10');
  await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('حفظ مؤكد دون انتظار القراءات');
  await page.getByRole('button', { name: 'اعتماد المعاملة', exact: true }).click();
  const row = page.locator('.ledger-record');
  await expect(row).toHaveCount(2);
  await expect(row.last()).toContainText('حفظ مؤكد دون انتظار القراءات');
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('');
  await row.last().getByRole('button', { name: /تعديل المعاملة/ }).click();
  const edit = page.locator('.ledger-draft-row').filter({ hasText: '#2' });
  await edit.getByLabel('قيمة المعاملة').fill('25');
  await edit.getByLabel('ملاحظة المعاملة').fill('تعديل مؤكد مرة واحدة');
  await edit.getByRole('button', { name: 'اعتماد المعاملة', exact: true }).click();
  await expect(row).toHaveCount(2);
  await expect(row.last()).toContainText('تعديل مؤكد مرة واحدة');
  await page.unroute('**/api/customers**');
  const accounts = await (await page.request.get(`${base}/api/customers`)).json();
  assert.equal(accounts.data.items[0].balanceUnits, 125);
  const ledger = await (await page.request.get(`${base}/api/customers/${accounts.data.items[0].id}/ledger`)).json();
  assert.equal(ledger.data.items.length, 2);
  assert.equal(ledger.data.items[1].amountUnits, 25);
  assert.deepEqual(errors, []);
  console.log('PASS performance: loading without retry, cached snapshot locked until validation, committed addition/correction survive failed reads without duplicates.');
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
  database.close();
}
