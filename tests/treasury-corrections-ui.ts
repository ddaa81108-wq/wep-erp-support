import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { addTreasuryCashEntry, treasuryDashboard } from '../src/server/domain/treasury.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const db = openDatabase(':memory:'),
  admin = fixtureAdmin(db);
const original = addTreasuryCashEntry(
  db,
  admin,
  {
    requestId: randomUUID(),
    expectedVersion: 0,
    direction: 'in',
    amountUnits: 5000,
    description: 'معاملة اختبار بقيمة خاطئة',
  },
  'test',
).entry;
for (let i = 0; i < 110; i++)
  addTreasuryCashEntry(
    db,
    admin,
    {
      requestId: randomUUID(),
      expectedVersion: i + 1,
      direction: 'in',
      amountUnits: 1,
      description: 'حركة اختبار مستقلة',
    },
    'test',
  );
db.prepare(
  `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
  SELECT 'cash-writer','cash-writer','موظف خزينة',password_hash,'employee',organization_id,home_branch_id,created_at,updated_at FROM users WHERE id=?`,
).run(admin.id);
for (const permission of ['treasury.read', 'treasury.write'])
  db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(
    'cash-writer',
    permission,
    new Date().toISOString(),
  );
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }),
);
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const open = async (id: string) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      session = createSession(db, id, '1', 12);
    await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(base + '/erp');
    await page.getByRole('button', { name: 'الخزينة', exact: true }).click();
    await expect(page.locator('.treasury-ledger [data-sequence]')).toHaveCount(100);
    return { page, context };
  };
  const { page } = await open(admin.id),
    { page: viewer } = await open(admin.id);
  console.log('Opened both treasury sessions.');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  viewer.on('pageerror', (error) => errors.push(error.message));
  for (const target of [page, viewer]) {
    await target.getByRole('button', { name: 'تحميل حركات أقدم', exact: true }).click();
    await expect(target.locator('.treasury-ledger [data-sequence]')).toHaveCount(111);
  }
  const edit = page.getByRole('button', { name: 'تعديل المعاملة 1', exact: true });
  assert.ok(
    await edit.evaluate(
      (button) => button.parentElement === button.closest('[data-sequence]')?.lastElementChild,
    ),
    'Edit is the last cell after the balance',
  );
  await expect(page.locator('.treasury-ledger-row.head > span')).toHaveCount(8);
  const form = page.getByRole('form', { name: 'تصحيح معاملة الخزينة' });
  await edit.click();
  console.log('Opened historical cash correction form.');
  await expect(form.getByLabel('القيمة الصحيحة', { exact: true })).toHaveValue('5000');
  await form.getByLabel('القيمة الصحيحة', { exact: true }).fill('500');
  await expect(form.locator(':scope > span').nth(6)).toHaveText('500');
  await expect(form.getByRole('textbox')).toHaveCount(1);
  await expect(form.locator('[aria-label="سبب التصحيح"]')).toHaveCount(0);
  assert.ok(
    await form.evaluate((el) => el.parentElement?.classList.contains('treasury-ledger')),
    'Editor replaces its transaction in the ledger',
  );
  assert.equal(
    treasuryDashboard(db, admin.organizationId).activeCashUnits,
    5110,
    'Preview cannot write money',
  );
  mkdirSync('artifacts/treasury-corrections', { recursive: true });
  for (const theme of ['light', 'dark'])
    for (const shell of ['original', '03'])
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(
          ({ theme, shell }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.royalShell = shell;
          },
          { theme, shell },
        );
        if (width < 700 && (await page.locator('.sidebar.open').count()))
          await page.getByRole('button', { name: 'إغلاق القائمة الرئيسية', exact: true }).click();
        await form.scrollIntoViewIfNeeded();
        assert.ok(
          await form.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          'Correction form fits phone',
        );
        if (width === 390) {
          const placement = await page.locator('[data-sequence="1"]').evaluate((row) => {
            const action = row.querySelector('.treasury-row-actions')!.getBoundingClientRect();
            const actor = row.children[5].getBoundingClientRect();
            return action.top >= actor.bottom - 1 && action.right <= row.getBoundingClientRect().right + 1;
          });
          assert.ok(placement, 'Phone edit action sits at the bottom of its transaction');
        }
        await expect(form.getByRole('button', { name: 'حفظ التعديل', exact: true })).toBeInViewport();
        await page.screenshot({ path: `artifacts/treasury-corrections/${theme}-${shell}-${width}.png` });
      }
  await page.setViewportSize({ width: 1440, height: 1000 });
  let loseResponse = true;
  const requests: string[] = [];
  await page.route('**/api/treasury/cash-entries/*/corrections', async (route) => {
    requests.push(route.request().postData()!);
    if (loseResponse) {
      loseResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    } else await route.continue();
  });
  await form.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  await expect(
    page.getByText('لم يتأكد الحفظ. أعد محاولة نفس التصحيح دون تغيير بياناته.', { exact: true }),
  ).toBeVisible();
  await expect(form.getByLabel('القيمة الصحيحة', { exact: true })).toBeDisabled();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_cash_corrections').get()!.n, 1);
  await form.getByRole('button', { name: 'إعادة محاولة التأكيد', exact: true }).click();
  await expect(form).toHaveCount(0);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_cash_entries').get()!.n, 112);
  assert.equal(treasuryDashboard(db, admin.organizationId).activeCashUnits, 610);
  for (const target of [page, viewer]) {
    await expect(target.locator('[data-sequence="1"] > span').nth(3)).toHaveText('500');
    await expect(target.locator('[data-sequence="1"] > span').nth(6)).toHaveText('500');
    await expect(target.locator('[data-sequence="2"] > span').nth(6)).toHaveText('501');
    await expect(target.locator('.treasury-ledger [data-sequence]')).toHaveCount(111);
    await expect(target.locator('[data-sequence="112"] .treasury-correct-button')).toHaveCount(0);
  }
  await page.unroute('**/api/treasury/cash-entries/*/corrections');
  await edit.click();
  await viewer.getByRole('button', { name: 'تعديل المعاملة 1', exact: true }).click();
  await expect(form.getByLabel('القيمة الصحيحة', { exact: true })).toHaveValue('500');
  await form.getByLabel('البيان المصحح', { exact: true }).fill('بيان مصحح فقط');
  await form.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  await expect(form).toHaveCount(0);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM treasury_cash_entries').get()!.n,
    112,
    'Description correction adds no cash',
  );
  const otherForm = viewer.getByRole('form', { name: 'تصحيح معاملة الخزينة' });
  await otherForm.getByLabel('القيمة الصحيحة', { exact: true }).fill('700');
  await otherForm.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  await expect(viewer.locator('.treasury-message')).toContainText('تم تعديل المعاملة من جهاز آخر');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_cash_corrections').get()!.n, 2);
  await edit.click();
  await form.getByLabel('الحركة الصحيحة', { exact: true }).selectOption('out');
  await expect(form.locator(':scope > span').nth(6)).toHaveText('-500');
  await form.getByRole('button', { name: 'حفظ التعديل', exact: true }).click();
  await expect(form).toHaveCount(0);
  assert.equal(treasuryDashboard(db, admin.organizationId).activeCashUnits, -390);
  const count = db.prepare('SELECT COUNT(*) n FROM treasury_cash_corrections').get()!.n;
  await edit.click();
  await form.getByRole('button', { name: 'إلغاء التعديل', exact: true }).click();
  await expect(form).toHaveCount(0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM treasury_cash_corrections').get()!.n, count);
  const { page: employee } = await open('cash-writer');
  await expect(employee.locator('.treasury-cash-actions')).toHaveCount(1);
  await expect(employee.locator('.treasury-correct-button')).toHaveCount(0);
  await expect(employee.locator('.treasury-ledger-row.head > span')).toHaveCount(7);
  assert.deepEqual(errors, []);
  assert.equal(
    db.prepare('SELECT balance_after_units FROM treasury_cash_entries WHERE id=?').get(original.id)!
      .balance_after_units,
    5000,
  );
  console.log(
    'PASS inline cash editing without reasons: historical original + two-device sync, lost response/replay, unchanged description cash, stale conflict, direction reversal, cancellation, employee restriction, both shells/themes/phone. Synthetic data only.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
