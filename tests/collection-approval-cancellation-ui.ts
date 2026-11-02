import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import {
  submitCollection,
  decideCollection,
  markCollectionCashReceived,
  createUnlinkedCollectionReceipt,
  decideUnlinkedCollectionReceipt,
  markUnlinkedCollectionCashReceived,
} from '../src/server/domain/collections.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';

const { db, admin, collector, assignments, ids } = collectionFixture();
const receipts = [];
for (const [i, amount] of [40, 15, 10].entries()) {
  const s = submitCollection(
    db,
    collector,
    assignments[0],
    { mode: 'partial', amountUnits: amount, requestId: 'cancel-ui-' + i },
    'test',
  );
  decideCollection(db, admin, s.id, { decision: 'approve' }, 'test');
  receipts.push(s);
}
markCollectionCashReceived(db, admin, receipts[1].id, 'test');
const unlinked = createUnlinkedCollectionReceipt(
  db,
  collector,
  { customerName: 'استلام مستقل للمراجعة', amountUnits: 20, requestId: 'cancel-ui-unlinked' },
  'test',
);
decideUnlinkedCollectionReceipt(
  db,
  admin,
  unlinked.id,
  { decision: 'approve', customerId: ids[1], entryType: 'payment' },
  'test',
);
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }),
);
const browser = await chromium.launch();
const errors: string[] = [];
mkdirSync('artifacts/collection-approval-cancellation', { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const open = async (id: string) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addCookies([
      {
        name: 'abdo_session',
        value: createSession(db, id, '1', 12).token,
        url: base,
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/erp');
    await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
    return page;
  };
  const page = await open(admin.id),
    employee = await open(collector.id);
  await employee.locator('#employee-tab-history').click();
  await page.locator('#board-tab-cash').click();
  const wrong = page.locator(`[data-receipt-id="${receipts[0].id}"]`);
  await wrong.getByRole('button', { name: 'إلغاء الاعتماد', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'إلغاء اعتماد الاستلام', exact: true });
  const confirm = dialog.getByRole('button', { name: 'إلغاء الاعتماد وتصحيح الرصيد', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog
    .getByLabel('سبب إلغاء الاعتماد', { exact: true })
    .fill('اختار الموظف العميل الخطأ ولم تُستلم نقدية');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
      .toBe(true);
    await dialog.screenshot({ path: `artifacts/collection-approval-cancellation/confirm-${width}.png` });
  }
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(wrong).toHaveCount(0);
  assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n, 75);
  await expect(employee.locator('.employee-receipts')).toContainText('أُلغي الاعتماد — صُحح الرصيد');
  await expect(employee.getByRole('button', { name: 'إلغاء الاعتماد', exact: true })).toHaveCount(0);
  // Lose an accepted cancellation response, then repeat exactly the same dialog request.
  let lost = false;
  const requests: unknown[] = [];
  await page.route('**/cancel-approval', async (route) => {
    requests.push(route.request().postDataJSON());
    if (!lost) {
      lost = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  const next = page.locator(`[data-receipt-id="${receipts[2].id}"]`);
  await next.getByRole('button', { name: 'إلغاء الاعتماد', exact: true }).click();
  await dialog.getByLabel('سبب إلغاء الاعتماد', { exact: true }).fill('تصحيح دفعة أخرى سُجلت بالخطأ');
  await confirm.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n, 85);
  // A stale dialog cannot cancel once another administrator has received the cash.
  await page.unroute('**/cancel-approval');
  const independent = page.locator(`[data-receipt-id="${unlinked.id}"]`);
  await independent.getByRole('button', { name: 'إلغاء الاعتماد', exact: true }).click();
  await dialog.getByLabel('سبب إلغاء الاعتماد', { exact: true }).fill('اختبار تعارض استلام النقدية');
  markUnlinkedCollectionCashReceived(db, admin, unlinked.id, 'test');
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('تم استلام نقدية');
  await dialog.getByRole('button', { name: 'رجوع', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#board-tab-all').click();
  await page.locator('.board-ledger > summary').click();
  await expect(page.locator('.board-receipt.is-cancelled')).toHaveCount(2);
  await page.screenshot({
    path: 'artifacts/collection-approval-cancellation/history.png',
    animations: 'disabled',
  });
  assert.equal(reconcileFinancials(db).status, 'matched');
  assert.deepEqual(errors, []);
  console.log(
    'PASS cancellation UI: mandatory reason, desktop/phone, employee evidence, exact lost-response retry, cash race blocked, other payments preserved.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
