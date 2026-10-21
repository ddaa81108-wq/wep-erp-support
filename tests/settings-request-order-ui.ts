import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Route } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { openDatabase } from '../src/server/db/database.ts';

// Isolated database: never uses or modifies the running ERP's financial data.
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
const result = (name: string) => ({
  ok: true,
  data: {
    items: [
      {
        id: 1,
        sourceKind: 'test',
        sourceId: '1',
        sectionKey: 'company_debts',
        entryKind: 'debt',
        counterpartyName: name,
        description: '',
        referenceNo: '',
        currency: 'LYD',
        amountUnits: 100,
        effectUnits: 100,
        actorName: 'Test',
        actorUsername: null,
        occurredAt: '2026-10-21T12:00:00Z',
        sourceStatus: 'posted',
        updatedAt: '2026-10-21T12:00:00Z',
      },
    ],
    pageTotals: { LYD: 100, EGP: 0 },
    nextBefore: null,
  },
});
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const setup = await page.request.post(`${base}/api/setup/admin`, {
    data: { username: 'admin', displayName: 'Test Admin', password: 'Request Order Test 123!' },
  });
  assert.ok(setup.ok());
  await page.goto(`${base}/erp`);
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Request Order Test 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'الإعدادات', exact: true }).click();

  const held = new Map<string, Route>();
  await page.route('**/api/financial-ledger*', async (route) => {
    if (new URL(route.request().url()).searchParams.get('section') === 'customer_debts') {
      held.set('pending', route);
      return;
    }
    await route.fulfill({ json: result('نتيجة حديثة') });
  });
  await page.getByRole('button', { name: /سجل الأستاذ المالي/ }).click();
  await expect(page.locator('.financial-ledger-description strong')).toHaveText('نتيجة حديثة');
  for (const staleError of [false, true]) {
    held.delete('pending');
    await page.getByLabel('تصفية القسم').selectOption('customer_debts');
    await expect.poll(() => held.has('pending')).toBe(true);
    await page.getByLabel('تصفية القسم').selectOption('company_debts');
    await expect(page.getByText('جارٍ التحديث…', { exact: true })).toHaveCount(0);
    const response = page.waitForResponse(
      (r) => new URL(r.url()).searchParams.get('section') === 'customer_debts',
    );
    const pending = held.get('pending');
    assert.ok(pending);
    await pending.fulfill(
      staleError
        ? { status: 500, json: { ok: false, error: { message: 'Stale request failure' } } }
        : { json: result('نتيجة قديمة') },
    );
    await response;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect(page.locator('.financial-ledger-description strong')).toHaveText('نتيجة حديثة');
    await expect(page.getByText('Stale request failure', { exact: true })).toHaveCount(0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: delayed financial ledger success and error cannot overwrite newer filters.');
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
}
