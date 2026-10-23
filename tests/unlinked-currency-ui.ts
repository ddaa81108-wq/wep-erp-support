import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createCustomer } from '../src/server/domain/customers.ts';
import { createUnlinkedCollectionReceipt } from '../src/server/domain/collections.ts';

const { db, collector, admin } = collectionFixture();
const server = createApp(
  db,
  loadConfig({
    databasePath: ':memory:',
    publicOrigin: '',
    secureCookie: false,
    internetRequired: false,
    pushPublicKey: '',
    pushPrivateKey: '',
  }),
);
let browser: Browser | undefined;
try {
  const lyd = createCustomer(
    db,
    admin,
    { requestId: 'ui-currency-lyd-account', name: 'عميل مطابقة العملة ليبي', openingBalance: 100 },
    'test',
  );
  const lydId = String((lyd.body.customer as { id: string }).id);
  const egp = createCustomer(
    db,
    admin,
    { requestId: 'ui-currency-egp-account', name: 'عميل مطابقة العملة مصري', openingBalance: 100 },
    'test',
    'depositEgp',
  );
  const egpId = String((egp.body.customer as { id: string }).id);
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch({ headless: true });
  const collectorContext = await browser.newContext();
  const collectorSession = createSession(db, collector.id, '1', 12);
  await collectorContext.addCookies([
    { name: 'abdo_session', value: collectorSession.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const employeePage = await collectorContext.newPage();
  const errors: string[] = [];
  employeePage.on('pageerror', (error) => errors.push(error.message));
  const bodies: Record<string, unknown>[] = [];
  employeePage.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/collections/unlinked-receipts'))
      bodies.push(request.postDataJSON());
  });
  await employeePage.goto(base + '/erp');
  await employeePage.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await employeePage.getByRole('button', { name: 'إنشاء عميل مستقل', exact: true }).click();
  const form = employeePage.locator('#collection-create-form');
  await expect(form).toContainText('عملة الاستلام: دينار ليبي فقط');
  await form.locator('input[name="customerName"]').fill('عميل مطابقة العملة');
  await form.locator('input[name="amountUnits"]').fill('25');
  await form.locator('input[name="amountUnits"]').press('Enter');
  await expect(employeePage.locator('.unlinked-receipt-card')).toContainText('25');
  assert.equal(bodies[0].currency, 'LYD');
  const adminContext = await browser.newContext();
  const session = createSession(db, admin.id, '1', 12);
  await adminContext.addCookies([
    { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const page = await adminContext.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await page.locator('.unlinked-admin-card').getByRole('button', { name: 'عميل قديم', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('عملة الاستلام: دينار ليبي فقط');
  await dialog.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect(dialog.locator('.collection-link-candidates')).toContainText('عميل مطابقة العملة ليبي');
  await expect(dialog.locator('.collection-link-candidates')).not.toContainText('عميل مطابقة العملة مصري');
  await dialog
    .locator('.collection-link-candidates label')
    .filter({ hasText: 'عميل مطابقة العملة ليبي' })
    .click();
  await dialog.getByRole('button', { name: 'ربط واعتماد', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.unlinked-admin-card')).toContainText('تم الربط والاعتماد');
  assert.equal(
    db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(lydId)!.balance,
    75,
  );
  assert.equal(
    db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(egpId)!.balance,
    100,
  );
  // A stale/malicious response must not expose an EGP candidate even if it claims LYD.
  createUnlinkedCollectionReceipt(
    db,
    collector,
    {
      requestId: 'ui-extra-currency-receipt',
      customerName: 'تجربة رد قديم',
      amountUnits: 10,
      currency: 'LYD',
    },
    'test',
  );
  await page.route('**/api/collections/link-candidates?*', (route) =>
    route.fulfill({
      json: {
        ok: true,
        data: {
          items: [
            {
              id: egpId,
              name: 'مرشح مصري ممنوع',
              balanceUnits: 100,
              sectionKey: 'egyptian_deposits',
              currency: 'LYD',
            },
          ],
        },
      },
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await page
    .locator('.unlinked-admin-card')
    .filter({ hasText: 'تجربة رد قديم' })
    .getByRole('button', { name: 'عميل قديم', exact: true })
    .click();
  await dialog.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect(dialog.locator('.collection-link-candidates')).not.toContainText('مرشح مصري ممنوع');
  await expect(dialog.getByRole('button', { name: 'ربط واعتماد', exact: true })).toBeDisabled();
  assert.deepEqual(errors, []);
  console.log(
    'PASS unlinked currency: LYD label and request; Egyptian accounts hidden; matching LYD approval; stale wrong-currency suggestions blocked.',
  );
} finally {
  await browser?.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
