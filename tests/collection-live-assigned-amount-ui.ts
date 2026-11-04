import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, collector, ids, assignments } = collectionFixture();
const server = createApp(db, loadConfig({ databasePath: ':memory:', secureCookie: false, internetRequired: false, publicOrigin: '' }));
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const writer = await browser.newContext();
  const writeSession = createSession(db, admin.id, '1', 12);
  await writer.addCookies([{ name: 'abdo_session', value: writeSession.token, url: base }]);
  async function mutate(path: string, data: Record<string, unknown>) {
    const response = await writer.request.post(base + path, { headers: { origin: base, 'X-CSRF-Token': writeSession.csrfToken, 'X-Client-Api-Version': '1' }, data });
    assert.ok(response.ok(), await response.text());
    return (await response.json()).data;
  }
  const adminContext = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const employeeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  for (const [context, actor] of [[adminContext, admin], [employeeContext, collector]] as const) {
    const session = createSession(db, actor.id, '1', 12);
    await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  }
  const adminPage = await adminContext.newPage(), employeePage = await employeeContext.newPage();
  const errors: string[] = [];
  for (const page of [adminPage, employeePage]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/erp');
    if (page === adminPage) {
      await expect(page.locator('.workspace')).toBeVisible({ timeout: 20000 });
      await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
    } else await expect(page.locator('.employee-collections-page')).toBeVisible({ timeout: 20000 });
  }
  await adminPage.getByRole('tab', { name: /كل الكروت/ }).click();
  const adminCard = adminPage.locator('.board-assignment').filter({ hasText: 'Recovery customer' });
  const employeeCard = employeePage.locator('.collection-card').filter({ hasText: 'Recovery customer' });
  async function amounts(assigned: number, balance: number) {
    for (const card of [adminCard, employeeCard]) {
      await expect(card.locator('[data-amount="assigned"] bdi')).toHaveText(String(assigned), { timeout: 10000 });
      await expect(card.locator('[data-amount="current"] bdi')).toHaveText(String(balance), { timeout: 10000 });
    }
  }
  await amounts(100, 100);
  await mutate(`/api/customers/${ids[0]}/transactions`, { requestId: 'live-ui-before-first', expectedVersion: 1, type: 'debt', inputValue: 200 });
  await amounts(300, 300);
  mkdirSync('artifacts/collection-live-assigned-amount', { recursive: true });
  await adminCard.screenshot({ path: 'artifacts/collection-live-assigned-amount/before-first-admin.png' });
  await employeeCard.locator('.partial-collection-details > summary').click();
  await employeeCard.locator('input[name="amount"]').fill('30');
  await employeeCard.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect.poll(() => db.prepare('SELECT COUNT(*) n FROM collection_submissions WHERE assignment_id=?').get(assignments[0])!.n).toBe(1);
  const first = db.prepare('SELECT id FROM collection_submissions WHERE assignment_id=?').get(assignments[0])!;
  await mutate(`/api/customers/${ids[0]}/transactions`, { requestId: 'live-ui-after-first', expectedVersion: 2, type: 'debt', inputValue: 50 });
  await amounts(300, 350);
  await mutate(`/api/collections/submissions/${first.id}/decision`, { decision: 'approve' });
  await amounts(300, 320);
  await employeeCard.screenshot({ path: 'artifacts/collection-live-assigned-amount/after-first-employee.png' });
  await adminCard.screenshot({ path: 'artifacts/collection-live-assigned-amount/after-first-admin.png' });
  assert.equal(db.prepare('SELECT first_submission_balance_units n FROM debt_assignments WHERE id=?').get(assignments[0])!.n, 300);
  assert.deepEqual(errors, []);
  console.log('PASS: live admin/employee card amounts 100→300; first partial freezes300; manual debt350 and approval320 retain300 without reload.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done())); db.close();
}
