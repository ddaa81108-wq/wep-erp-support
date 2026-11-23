import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createCollectionPayrollEntry, confirmCollectionPayrollEntry } from '../src/server/domain/collectionPayroll.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

const { db, admin, collector } = collectionFixture();
const withdrawal = createCollectionPayrollEntry(db, admin, { employeeUserId: collector.id, kind: 'withdrawal', amountUnits: 100, reason: 'سحب اختبار للإلغاء', requestId: 'ui-cancel-withdrawal' }, 'test');
const commission = createCollectionPayrollEntry(db, admin, { employeeUserId: collector.id, kind: 'commission', amountUnits: 500, reason: 'عمولة اختبار للإلغاء', requestId: 'ui-cancel-commission' }, 'test');
confirmCollectionPayrollEntry(db, collector, commission.id, 'test');
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false, pushPublicKey: '', pushPrivateKey: '' }));
const browser = await chromium.launch();
mkdirSync('artifacts/payroll-cancellation', { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const errors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', dialog => void dialog.accept());
  await page.goto(base + '/erp');
  await page.locator('.sidebar nav').getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await page.getByRole('button', { name: 'المرتبات', exact: true }).click();
  await page.locator('.payroll-employee-picker select').selectOption(collector.id);
  const row = (id: string) => page.locator(`[data-payroll-entry-id="${id}"]`);
  await expect(row(withdrawal.id).getByRole('button', { name: 'إلغاء المعاملة', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/payroll-cancellation/before.png' });
  const path = `/api/collections/payroll/entries/${withdrawal.id}/cancel`;
  let release!: () => void, attempts = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**' + path, async route => {
    attempts++;
    await gate;
    await route.fetch(); // Server commits but the browser loses the acknowledgement.
    await route.abort('connectionreset');
  });
  await row(withdrawal.id).getByRole('button', { name: 'إلغاء المعاملة', exact: true }).click();
  await expect.poll(() => attempts).toBe(1);
  await row(withdrawal.id).getByRole('button', { name: 'إلغاء المعاملة', exact: true }).evaluate(button => { for (let i = 0; i < 20; i++) (button as HTMLButtonElement).click(); });
  assert.equal(attempts, 1, 'Repeated clicks stay locked while cancellation is in flight');
  release();
  await expect.poll(async () => await row(withdrawal.id).getAttribute('data-cancelled') === 'true' || await page.locator('.payroll-workspace .alert.error').isVisible()).toBe(true);
  await page.unroute('**' + path);
  if (await row(withdrawal.id).getAttribute('data-cancelled') !== 'true') await row(withdrawal.id).getByRole('button', { name: 'إلغاء المعاملة', exact: true }).click();
  await expect(row(withdrawal.id)).toHaveAttribute('data-cancelled', 'true');
  await row(commission.id).getByRole('button', { name: 'إلغاء المعاملة', exact: true }).click();
  await expect(row(commission.id)).toHaveAttribute('data-cancelled', 'true');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await page.screenshot({ path: `artifacts/payroll-cancellation/after-${theme}.png` });
  }
  const dashboard = (await (await context.request.get(base + '/api/collections/payroll')).json()).data;
  const employee = dashboard.employees.find((item: { employeeId: string }) => item.employeeId === collector.id);
  assert.equal(employee.remainingUnits, 3500); assert.equal(employee.withdrawalsUnits, 0); assert.equal(employee.commissionsUnits, 0);
  assert.equal(employee.entries.length, 0, 'Existing mobile clients do not receive cancelled rows');
  const history = (await (await context.request.get(base + '/api/collections/payroll?includeCancelled=1')).json()).data;
  assert.equal(history.employees.find((item: { employeeId: string }) => item.employeeId === collector.id).entries.length, 2);
  const csrf = (await (await context.request.get(base + '/api/auth/csrf')).json()).data.csrfToken;
  const replay = await context.request.post(base + path, { headers: { origin: base, 'X-CSRF-Token': csrf, 'X-Client-Api-Version': '1' }, data: {} });
  assert.equal(replay.status(), 200); assert.equal((await replay.json()).data.replayed, true);
  const staff = await browser.newContext();
  const staffSession = createSession(db, collector.id, '1', 12);
  await staff.addCookies([{ name: 'abdo_session', value: staffSession.token, url: base }]);
  const staffPage = await staff.newPage();
  await staffPage.goto(base + '/erp');
  await staffPage.locator('.sidebar nav').getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await staffPage.getByRole('button', { name: 'المرتبات', exact: true }).click();
  await expect(staffPage.locator('.payroll-ledger article')).toHaveCount(2);
  await expect(staffPage.locator('.cancel-payroll-entry,.confirm-payroll')).toHaveCount(0);
  const staffCsrf = (await (await staff.request.get(base + '/api/auth/csrf')).json()).data.csrfToken;
  const denied = await staff.request.post(base + path, { headers: { origin: base, 'X-CSRF-Token': staffCsrf, 'X-Client-Api-Version': '1' }, data: {} });
  assert.equal(denied.status(), 403);
  assert.equal((await denied.json()).error.code, 'PERMISSION_DENIED');
  assert.equal((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='collection.payroll.entry.cancel'").get() as { n: number }).n, 2);
  assert.deepEqual(errors, []);
  console.log('PASS: admin cancellation before/after employee confirmation, 20 locked clicks, lost reply + safe retry, correct totals, retained rows, employee UI and API denied. Isolated database only.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
