import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { assignCustomers, submitCollection, decideCollection } from '../src/server/domain/collections.ts';
import { createCustomer } from '../src/server/domain/customers.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, collector, other, ids, assignments } = collectionFixture();
const zeroReceipt = submitCollection(
  db,
  collector,
  assignments[0],
  { mode: 'full', requestId: 'ui-unassign-zero' },
  'test',
);
decideCollection(db, admin, zeroReceipt.id, { decision: 'approve' }, 'test');
const company = createCustomer(
  db,
  admin,
  { name: 'شركة اختبار سحب التوجيه', openingBalance: 100, requestId: 'ui-unassign-company' },
  'test',
  'company',
);
const companyId = String((company.body.customer as { id: string }).id);
const companyAssignment = assignCustomers(
  db,
  admin,
  { customerIds: [companyId], assigneeUserId: collector.id, section: 'companies' },
  'test',
).assignmentIds[0];
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', secureCookie: false, publicOrigin: '', internetRequired: false }),
);
const browser = await chromium.launch();
mkdirSync('artifacts/collection-unassign', { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([
    { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const staff = await browser.newContext();
  const staffSession = createSession(db, collector.id, '1', 12);
  await staff.addCookies([
    { name: 'abdo_session', value: staffSession.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const denied = await staff.request.post(`${base}/api/collections/assignments/${assignments[0]}/cancel`, {
    headers: { origin: base, 'X-CSRF-Token': staffSession.csrfToken, 'X-Client-Api-Version': '1' },
    data: {},
  });
  assert.equal(denied.status(), 403);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/erp');
  const zero = page.getByRole('button', {
    name: 'إلغاء توجيه Recovery customer من fixture-collector',
    exact: true,
  });
  await expect(zero).toBeVisible();
  page.once('dialog', (dialog) => dialog.dismiss());
  await zero.click();
  await expect(zero).toBeVisible();
  assert.equal(
    db.prepare('SELECT status FROM debt_assignments WHERE id=?').get(assignments[0])!.status,
    'active',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await zero.click();
  await expect(zero).toHaveCount(0);
  assert.equal(
    db.prepare('SELECT current_balance_units FROM customers WHERE id=?').get(ids[0])!.current_balance_units,
    0,
  );
  const cash = db
    .prepare('SELECT status,collector_user_id,cash_received_at FROM collection_submissions WHERE id=?')
    .get(zeroReceipt.id)!;
  assert.equal(cash.status, 'approved');
  assert.equal(cash.collector_user_id, collector.id);
  assert.equal(cash.cash_received_at, null);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .getByRole('button', { name: 'إلغاء توجيه Second customer من fixture-collector', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'إلغاء توجيه Second customer من fixture-collector', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'التوجيه', exact: true }).click();
  await page.locator('.routing-bar select').selectOption(other.id);
  await page.locator('.customer-card-main').filter({ hasText: 'Second customer' }).click();
  await page.getByRole('button', { name: 'تأكيد التوجيه', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'إلغاء توجيه Second customer من fixture-other', exact: true }),
  ).toBeVisible();
  assert.equal(
    db
      .prepare("SELECT assignee_user_id FROM debt_assignments WHERE customer_id=? AND status='active'")
      .get(ids[1])!.assignee_user_id,
    other.id,
  );
  await page.screenshot({ path: 'artifacts/collection-unassign/customers-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('button', { name: 'إلغاء توجيه Second customer من fixture-other', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'artifacts/collection-unassign/customers-mobile.png' });
  await page.evaluate((id) => localStorage.setItem('abdo-erp-active-section:' + id, 'companies'), admin.id);
  await page.reload();
  const companyButton = page.getByRole('button', {
    name: 'إلغاء توجيه شركة اختبار سحب التوجيه من fixture-collector',
    exact: true,
  });
  await expect(companyButton).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await companyButton.click();
  await expect(companyButton).toHaveCount(0);
  assert.equal(
    db.prepare('SELECT status FROM debt_assignments WHERE id=?').get(companyAssignment)!.status,
    'cancelled',
  );
  assert.equal(
    db.prepare('SELECT current_balance_units FROM customers WHERE id=?').get(companyId)!
      .current_balance_units,
    100,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: admin-only cancellation, dismissed confirmation, zero balance, original cash owner, reassignment through UI, customer/company cards, desktop/mobile, no page errors.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
