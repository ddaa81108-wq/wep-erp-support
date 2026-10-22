import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { loadConfig } from '../src/server/config.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import { createSession } from '../src/server/security/sessions.ts';

mkdirSync('artifacts', {recursive: true});
const browser = await chromium.launch();
try {
  for (const role of ['admin', 'employee'] as const) {
    const db = openDatabase(':memory:');
    const actor = fixtureAdmin(db);
    createCustomer(db, actor, { name: 'عميل اختبار التنبيه', openingBalance: 0, requestId: 'duplicate-ui-account' }, 'test');
    if (role === 'employee') {
      db.prepare("UPDATE users SET role='employee' WHERE id=?").run(actor.id);
      for (const permission of ['debts.read', 'debts.write'])
        db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(actor.id, permission, new Date().toISOString());
    }
    const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }));
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
      await page.goto(`${base}/erp`);
      console.log(`Opened duplicate test for ${role}`);
      await expect(page.locator('.customer-card-main')).toBeVisible({timeout: 20_000});
      await page.locator('.customer-card-main').click();
      const amount = page.getByLabel('قيمة المعاملة', {exact: true});
      const note = page.getByLabel('ملاحظة المعاملة', {exact: true});
      const submit = page.getByRole('button', {name: 'اعتماد المعاملة', exact: true});
      await amount.fill('25');
      await note.fill('المعاملة الأولى');
      await submit.click();
      await expect(page.locator('.ledger-record')).toHaveCount(1);
      await amount.fill('25');
      await note.fill('المعاملة المكررة المقصودة');
      await submit.click();
      const warning = page.getByRole('alertdialog', {name: 'تنبيه معاملة مكررة'});
      await expect(warning).toBeVisible();
      assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, 1);
      await expect(warning.getByRole('button', {name: 'رجوع للمراجعة'})).toBeFocused();
      await page.screenshot({path: `artifacts/duplicate-warning-${role}.png`});
      const box = await warning.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= page.viewportSize()!.width + 1);
      await warning.getByRole('button', {name: 'رجوع للمراجعة'}).click();
      await expect(warning).toHaveCount(0);
      await expect(amount).toHaveValue('25');
      await expect(note).toHaveValue('المعاملة المكررة المقصودة');
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(warning).toBeVisible();
      await warning.getByRole('button', {name: 'إضافة مرة أخرى'}).click();
      await expect(page.locator('.ledger-record')).toHaveCount(2);
      await expect(amount).toHaveValue('');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, 2);
      await amount.fill('26');
      await submit.click();
      await expect(page.locator('.ledger-record')).toHaveCount(3);
      await expect(warning).toHaveCount(0);
      assert.deepEqual(errors, []);
      if (role === 'admin') {
        await page.evaluate(() => localStorage.setItem('abdo-erp-language', 'en'));
        await page.reload();
        await page.locator('.customer-card-main').click();
        await page.getByLabel('Transaction amount', {exact: true}).fill('25');
        await page.getByRole('button', {name: 'Approve transaction', exact: true}).click();
        const englishWarning = page.getByRole('alertdialog', {name: 'Possible duplicate transaction'});
        await expect(englishWarning).toBeVisible();
        await englishWarning.getByRole('button', {name: 'Go back to review'}).click();
        assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, 3);
      }
      console.log(`PASS duplicate warning ${role}: current record/day, review preserves draft, explicit repeat creates once, different value needs no warning.`);
    } catch (error) {
      console.error(error);
      throw error;
    } finally {
      await context.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
    }
  }
} finally { await browser.close(); }
