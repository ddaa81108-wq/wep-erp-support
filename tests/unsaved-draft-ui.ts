import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { loadConfig } from '../src/server/config.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { createSession } from '../src/server/security/sessions.ts';

const browser = await chromium.launch();
try {
  for (const role of ['admin', 'employee'] as const) {
    const db = openDatabase(':memory:');
    const actor = fixtureAdmin(db);
    createCustomer(db, actor, {name: 'عميل حماية المسودة', openingBalance: 0, requestId: 'draft-test-customer'}, 'test');
    if (role === 'admin') {
      db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
        VALUES('draft-payroll-user','draft-payroll-user','موظف المسودات','test','employee',?,?,?,?)`)
        .run(actor.organizationId, actor.homeBranchId, new Date().toISOString(), new Date().toISOString());
      db.prepare("INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('draft-payroll-user','collections.read',1,?)").run(new Date().toISOString());
    }
    if (role === 'employee') {
      db.prepare("UPDATE users SET role='employee' WHERE id=?").run(actor.id);
      for (const permission of ['debts.read', 'debts.write', 'companies.read'])
        db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(actor.id, permission, new Date().toISOString());
    }
    const server = createApp(db, loadConfig({databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false}));
    const context = await browser.newContext({viewport: role === 'admin' ? {width: 1366, height: 900} : {width: 390, height: 844}});
    try {
      await listen(server, '127.0.0.1', 0);
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      const session = createSession(db, actor.id, '1', 12);
      await context.addCookies([{name: 'abdo_session', value: session.token, url: base}]);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      let accept = false;
      const dialogs: string[] = [];
      page.on('dialog', dialog => {
        dialogs.push(dialog.message());
        void (accept ? dialog.accept() : dialog.dismiss());
      });
      const confirm = async (action: () => Promise<unknown>, allow = false) => {
        const count = dialogs.length;
        accept = allow;
        await action();
        await expect.poll(() => dialogs.length).toBe(count + 1);
        assert.match(dialogs.at(-1)!, /غير محفوظة/);
        accept = false;
      };
      const leaveBlocked = () => page.evaluate(() => {
        const event = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
      await page.goto(`${base}/erp`);
      const card = page.locator('.customer-card-main').first();
      await expect(card).toBeVisible({timeout: 20_000});
      await card.click();
      const ledger = page.locator('.ledger-panel');
      const close = page.getByRole('button', {name: 'إغلاق السجل', exact: true});
      const amount = page.getByLabel('قيمة المعاملة', {exact: true});
      const note = page.getByLabel('ملاحظة المعاملة', {exact: true});
      await close.click();
      await expect(ledger).toHaveCount(0);
      assert.equal(dialogs.length, 0, 'untouched form must not warn');
      await card.click();
      await amount.fill('17');
      await note.fill('مسودة تبقى عند الرجوع');
      assert.equal(await leaveBlocked(), true);
      await confirm(() => close.click());
      await expect(amount).toHaveValue('17');
      if (role === 'admin') {
        // Exercise the navigation handler while the ledger's modal shade covers the sidebar.
        await confirm(() => page.locator('.sidebar nav').getByRole('button', {name: 'قسم ديون الشركات', exact: true}).evaluate((button: HTMLButtonElement) => button.click()));
        await expect(amount).toHaveValue('17');
      }
      await confirm(() => page.evaluate(() => history.back()));
      await expect(note).toHaveValue('مسودة تبقى عند الرجوع');
      await confirm(() => close.click(), true);
      await expect(ledger).toHaveCount(0);
      await card.click();
      await expect(amount).toHaveValue('17');
      await amount.fill('');
      await note.fill('');
      assert.equal(await leaveBlocked(), false, 'reverting changes clears the warning');
      await amount.fill('29');
      await page.getByRole('button', {name: 'اعتماد المعاملة', exact: true}).click();
      await expect(page.locator('.ledger-record')).toHaveCount(1);
      await expect(amount).toHaveValue('');
      const count = dialogs.length;
      await close.click();
      await expect(ledger).toHaveCount(0);
      assert.equal(dialogs.length, count, 'saved entry must not warn');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, 1);
      if (role === 'admin') {
        await card.click();
        await amount.fill('31');
        await page.getByRole('button', {name: 'اعتماد المعاملة', exact: true}).click();
        await expect(page.locator('.ledger-record')).toHaveCount(2);
        await page.locator('.ledger-record').first().getByRole('button', {name: /تعديل المعاملة/}).click();
        const editing = page.locator('.ledger-draft-row').filter({hasText: '#1'});
        await editing.getByLabel('ملاحظة المعاملة', {exact: true}).fill('تعديل لم يُعتمد');
        await confirm(() => page.locator('.ledger-record').last().getByRole('button', {name: /تعديل المعاملة/}).click());
        await expect(editing.getByLabel('ملاحظة المعاملة', {exact: true})).toHaveValue('تعديل لم يُعتمد');
        await confirm(() => editing.getByRole('button', {name: 'إلغاء المسودة', exact: true}).click(), true);
        await close.click();
        await expect(ledger).toHaveCount(0);
        await page.getByRole('button', {name: /إضافة عميل/}).click();
        const modal = page.getByRole('dialog');
        await modal.locator('input[name="name"]').fill('حساب لم يُحفظ');
        await expect(modal.locator('input[name="name"]')).toHaveValue('حساب لم يُحفظ');
        await confirm(() => modal.getByRole('button', {name: 'إغلاق', exact: true}).click());
        await expect(modal.locator('input[name="name"]')).toHaveValue('حساب لم يُحفظ');
        await confirm(() => modal.getByRole('button', {name: 'إغلاق', exact: true}).click(), true);
        await expect(modal).toHaveCount(0);
        await card.click();
        await page.getByRole('button', {name: 'تعديل البيانات', exact: true}).click();
        await modal.locator('input[name="phone"]').fill('0912345678');
        await confirm(() => modal.getByRole('button', {name: 'إغلاق', exact: true}).click());
        await expect(modal.locator('input[name="phone"]')).toHaveValue('0912345678');
        await confirm(() => modal.getByRole('button', {name: 'إغلاق', exact: true}).click(), true);
        await expect(modal).toHaveCount(0);
        await close.click();
        await expect(ledger).toHaveCount(0);
        const nav = (name: string) => page.locator('.sidebar nav').getByRole('button', {name, exact: true}).click();
        await nav('قسم المشتريات');
        await page.getByLabel('القيمة ج.م', {exact: true}).fill('100');
        await confirm(() => nav('الخزينة'));
        await expect(page.getByLabel('القيمة ج.م', {exact: true})).toHaveValue('100');
        await confirm(() => nav('الخزينة'), true);
        await page.getByRole('button', {name: 'دخول', exact: true}).click();
        const form = page.locator('.treasury-entry-form');
        await form.locator('input[name="amountUnits"]').fill('55');
        await confirm(() => form.getByRole('button', {name: 'إلغاء', exact: true}).click());
        await expect(form.locator('input[name="amountUnits"]')).toHaveValue('55');
        await confirm(() => form.getByRole('button', {name: 'إلغاء', exact: true}).click(), true);
        await expect(form).toHaveCount(0);
        assert.equal(await leaveBlocked(), false, 'discarded forms unregister their guards');
        await nav('قسم استلامات الديون');
        await page.locator('.payroll-open-button').click();
        const payroll = page.locator('.payroll-entry-form');
        await payroll.locator('input[name="amountUnits"]').fill('50');
        await payroll.locator('input[name="reason"]').fill('اختبار حفظ المرتب');
        await payroll.getByRole('button').click();
        await expect(payroll.locator('input[name="amountUnits"]')).toHaveValue('');
        await expect(payroll.getByRole('button')).toBeEnabled();
        // A new draft identical to the previously saved one is still unsaved.
        await payroll.locator('input[name="amountUnits"]').fill('50');
        await payroll.locator('input[name="reason"]').fill('اختبار حفظ المرتب');
        await confirm(() => page.locator('.payroll-back').click());
        await expect(payroll.locator('input[name="amountUnits"]')).toHaveValue('50');
        await confirm(() => page.locator('.payroll-back').click(), true);
        await expect(payroll).toHaveCount(0);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_payroll_entries').get()!.n, 1);
        await nav('قسم ديون العملاء');
        await card.click();
        await amount.fill('13');
        await confirm(() => page.getByRole('button', {name: 'Switch to English', exact: true})
          .evaluate((button: HTMLButtonElement) => button.click()), true);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await page.locator('.customer-card-main').first().click();
        await expect(page.getByLabel('Transaction amount', {exact: true})).toHaveValue('13');
        await page.getByLabel('Transaction amount', {exact: true}).fill('');
      }
      assert.deepEqual(errors, []);
      console.log(`PASS unsaved draft ${role}: clean close, cancel/confirm close, section/back navigation, refresh warning, restored draft, saved reset.`);
    } catch (error) { console.error(error); throw error; }
    finally {
      await context.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    }
  }
} finally { await browser.close(); }
