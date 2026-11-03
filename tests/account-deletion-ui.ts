import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Page } from '@playwright/test';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer, addCustomerTransaction } from '../src/server/domain/customers.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const db = openDatabase(':memory:');
const admin = fixtureAdmin(db);
const examples = [
  ['companies', 'company', 100],
  ['customers', 'customer', 0],
  ['libyan-deposits', 'depositLyd', -25],
  ['egyptian-deposits', 'depositEgp', 50],
] as const;
const fixtures = examples.map(([section, kind, amount]) => {
  const name = 'ملف تجريبي ' + section;
  const result = createCustomer(
    db,
    admin,
    { name, openingBalance: Math.max(0, amount), requestId: 'delete-ui-' + section },
    'test',
    kind,
  );
  const id = String((result.body.customer as { id: string }).id);
  if (amount < 0)
    addCustomerTransaction(
      db,
      admin,
      id,
      { requestId: 'delete-ui-credit-' + section, expectedVersion: 1, type: 'payment', inputValue: -amount },
      'test',
      kind,
    );
  return { section, name, amount, id };
});
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', secureCookie: false, publicOrigin: '', internetRequired: false }),
);
const browser = await chromium.launch();
mkdirSync('artifacts/account-deletion', { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1440, height: 950 } }),
    browser.newContext(),
  ]);
  for (const context of contexts) {
    const session = createSession(db, admin.id, '1', 12);
    await context.addCookies([
      { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
    ]);
  }
  const missingCsrf = await contexts[0].request.delete(`${base}/api/companies/${fixtures[0].id}`, {
    headers: { origin: base, 'X-Client-Api-Version': '1' },
    data: {},
  });
  assert.equal(missingCsrf.status(), 403);
  const stamp = new Date().toISOString();
  db.prepare(
    "INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at) VALUES('delete-staff','delete-staff','موظف اختبار','test-only','employee',?,?,?,?)",
  ).run(admin.organizationId, admin.homeBranchId, stamp, stamp);
  const staffContext = await browser.newContext();
  const staffSession = createSession(db, 'delete-staff', '1', 12);
  await staffContext.addCookies([
    { name: 'abdo_session', value: staffSession.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const denied = await staffContext.request.delete(`${base}/api/companies/${fixtures[0].id}`, {
    headers: { origin: base, 'X-Client-Api-Version': '1', 'X-CSRF-Token': staffSession.csrfToken },
    data: {},
  });
  assert.equal(denied.status(), 403);
  const page = await contexts[0].newPage(),
    observer = await contexts[1].newPage();
  const errors: string[] = [];
  for (const tab of [page, observer]) tab.on('pageerror', (error) => errors.push(error.message));
  async function openSection(tab: Page, section: string) {
    if (tab.url() === 'about:blank') {
      await tab.goto(base + '/erp');
      // Finish session resume before reloading, so two CSRF rotations cannot race.
      await expect(tab.locator('.workspace')).toBeVisible({ timeout: 20000 });
    }
    await tab.evaluate(({ id, section }) => localStorage.setItem('abdo-erp-active-section:' + id, section), {
      id: admin.id,
      section,
    });
    await tab.reload();
    await expect(tab.locator(`.workspace.active-section-${section} .content-card`).first()).toBeVisible({
      timeout: 20000,
    });
  }
  for (const [index, fixture] of fixtures.entries()) {
    await page.setViewportSize({ width: index % 2 ? 390 : 1440, height: 950 });
    await openSection(page, fixture.section);
    if (index === 0) {
      await openSection(observer, fixture.section);
      await observer.locator('.customer-card-main').filter({ hasText: fixture.name }).click();
      await expect(observer.locator('.ledger-panel')).toBeVisible();
    }
    await page.locator('.customer-card-main').filter({ hasText: fixture.name }).click();
    await page.getByRole('button', { name: 'تعديل البيانات', exact: true }).click();
    await page.getByRole('button', { name: 'حذف الكارت', exact: true }).click();
    const dialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'حذف الكارت', exact: true }) });
    const confirm = dialog.getByRole('button', { name: 'تأكيد حذف الكارت', exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('اكتب اسم الكارت لتأكيد الحذف').fill('اسم غير مطابق');
    await dialog.getByLabel('سبب الحذف').fill('إنشاء الحساب في القسم الصحيح');
    try {
      await dialog.getByRole('checkbox').check();
    } catch (error) {
      await page.screenshot({ path: 'artifacts/account-deletion/checkbox-failure.png' });
      throw error;
    }
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('اكتب اسم الكارت لتأكيد الحذف').fill(fixture.name);
    await expect(confirm).toBeEnabled();
    await page.screenshot({ path: `artifacts/account-deletion/${fixture.section}-confirmation.png` });
    if (index === 0) {
      const csrfResponse = await contexts[1].request.get(base + '/api/auth/csrf');
      const csrf = (await csrfResponse.json()).data.csrfToken;
      const change = await contexts[1].request.post(`${base}/api/companies/${fixture.id}/transactions`, {
        headers: { origin: base, 'X-Client-Api-Version': '1', 'X-CSRF-Token': csrf },
        data: { requestId: 'delete-ui-concurrent-write', expectedVersion: 1, type: 'debt', inputValue: 10 },
      });
      assert.equal(change.status(), 201, await change.text());
      await expect(observer.locator('.ledger-total strong')).toContainText('110');
      await confirm.click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      assert.equal(
        db.prepare('SELECT deleted_at FROM customers WHERE id=?').get(fixture.id)!.deleted_at,
        null,
      );
      page.once('dialog', (value) => value.accept());
      await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
      await page.getByRole('button', { name: 'حذف الكارت', exact: true }).click();
      await dialog.getByLabel('اكتب اسم الكارت لتأكيد الحذف').fill(fixture.name);
      await dialog.getByLabel('سبب الحذف').fill('راجعت الرصيد الجديد وأريد تصحيح القسم');
      await dialog.getByRole('checkbox').check();
    }
    await confirm.click();
    await expect(page.locator('.ledger-panel')).toHaveCount(0, { timeout: 10000 });
    await expect(page.locator('.customer-card-main').filter({ hasText: fixture.name })).toHaveCount(0);
    assert.ok(db.prepare('SELECT deleted_at FROM customers WHERE id=?').get(fixture.id)!.deleted_at);
    if (index === 0) {
      await expect(observer.locator('.ledger-panel')).toHaveCount(0, { timeout: 10000 });
      await expect(observer.locator('.customer-card-main').filter({ hasText: fixture.name })).toHaveCount(0);
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await openSection(page, 'customers');
  await page.getByRole('button', { name: 'إضافة عميل', exact: true }).click();
  const create = page.getByRole('dialog');
  await create.locator('input[name="name"]').fill(fixtures[0].name);
  const distinct = create.getByRole('button', { name: 'ليس الحساب المطلوب — إنشاء حساب جديد', exact: true });
  if (await distinct.isVisible()) await distinct.click();
  await create.getByRole('button', { name: 'حفظ الحساب', exact: true }).click();
  await expect(page.locator('.ledger-panel')).toBeVisible();
  const replacement = db
    .prepare(
      "SELECT id,current_balance_units FROM customers WHERE name=? AND section_key='customer_debts' AND deleted_at IS NULL",
    )
    .get(fixtures[0].name)!;
  assert.ok(replacement);
  assert.notEqual(replacement.id, fixtures[0].id);
  assert.equal(replacement.current_balance_units, 0);
  assert.deepEqual(errors, []);
  console.log(
    'PASS: four sections, exact-name/balance confirmation, desktop/mobile deletion, other-device open ledger closes, and company recreated as a new customer without carrying balance.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
