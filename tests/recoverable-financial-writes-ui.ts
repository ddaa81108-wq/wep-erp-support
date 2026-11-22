import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

// Real HTTP writes to a private in-memory database, with replies deliberately lost.
const { db, admin, collector } = collectionFixture();
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
const browser = await chromium.launch();
const errors: string[] = [];
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const mode of ['unlinked', 'payroll'] as const) {
    console.log(`Checking isolated ${mode} submissions.`);
    const user = mode === 'unlinked' ? collector : admin;
    const context = await browser.newContext();
    await context.addCookies([
      { name: 'abdo_session', value: createSession(db, user.id, '1', 12).token, url: base },
    ]);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const posts: Record<string, unknown>[] = [];
    const path =
      mode === 'unlinked' ? '/api/collections/unlinked-receipts' : '/api/collections/payroll/entries';
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**' + path, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      posts.push(route.request().postDataJSON());
      if (posts.length === 1) {
        await gate;
        await route.fetch(); // Commit successfully, then hide its acknowledgement.
        await route.abort('failed');
      } else await route.continue();
    });
    async function open() {
      await page.goto(base + '/erp');
      const navigation = page.getByRole('button', { name: 'قسم استلامات الديون', exact: true });
      await expect(navigation).toBeVisible();
      if (!(await navigation.getAttribute('class'))?.includes('active')) await navigation.click();
      if (mode === 'payroll') await page.getByRole('button', { name: 'المرتبات', exact: true }).click();
    }
    await open();
    if (mode === 'unlinked')
      await page.getByRole('button', { name: 'إنشاء عميل مستقل', exact: true }).click();
    const form = page.locator(mode === 'unlinked' ? '.unlinked-create-panel form' : '.payroll-entry-form');
    if (mode === 'unlinked') await form.locator('[name=customerName]').fill('Isolated receipt');
    else await form.locator('[name=reason]').fill('Isolated payroll');
    await form.locator('[name=amountUnits]').fill('37');
    await form.locator('button').evaluate((button) => {
      for (let i = 0; i < 20; i++) (button as HTMLButtonElement).click();
    });
    await expect.poll(() => posts.length).toBe(1);
    await expect(form.locator('button')).toBeDisabled();
    release();
    const recovery = page.locator(
      mode === 'unlinked' ? '.pending-unlinked-recovery' : '.pending-payroll-recovery',
    );
    await expect(recovery).toBeVisible();
    await expect(recovery.locator('button')).toBeEnabled();
    const table = mode === 'unlinked' ? 'collection_unlinked_receipts' : 'collection_payroll_entries';
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 1);
    // A different amount cannot replace the unresolved operation.
    await form.locator('[name=amountUnits]').fill('38');
    await form.locator('button').click();
    await expect(
      page.getByText('توجد محاولة لم يتأكد ردها. أعد التحقق من العملية السابقة قبل تسجيل عملية جديدة.', {
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(posts.length, 1);
    // Reload must preserve the original payload/identity for an explicit retry.
    await open();
    await expect(recovery).toBeVisible();
    if (mode === 'unlinked') {
      db.prepare(
        "UPDATE user_permissions SET allowed=0 WHERE user_id=? AND permission='collections.write'",
      ).run(user.id);
      await recovery.locator('button').click();
      await expect.poll(() => posts.length).toBe(2);
      await expect(recovery.locator('button')).toBeEnabled();
      assert.deepEqual(posts[1], posts[0], 'Permission failures during recovery retain the original request');
      db.prepare(
        "UPDATE user_permissions SET allowed=1 WHERE user_id=? AND permission='collections.write'",
      ).run(user.id);
    }
    await recovery.locator('button').click();
    await expect(recovery).toHaveCount(0);
    const expectedPosts = mode === 'unlinked' ? 3 : 2;
    assert.equal(posts.length, expectedPosts);
    assert.deepEqual(posts[0], posts.at(-1));
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 1);
    const journal = `abdo:${mode === 'unlinked' ? 'unlinked' : 'payroll'}-write:${user.id}`;
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), journal), null);
    // Blocking browser storage must fail before a fresh request is sent.
    if (mode === 'unlinked')
      await page.getByRole('button', { name: 'إنشاء عميل مستقل', exact: true }).click();
    if (mode === 'unlinked') await form.locator('[name=customerName]').fill('New isolated receipt');
    else await form.locator('[name=reason]').fill('New isolated payroll');
    await form.locator('[name=amountUnits]').fill('39');
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new Error('Storage unavailable');
      };
    });
    await form.locator('button').click();
    await expect(
      page.getByText('تعذر حفظ مفتاح الطلب على هذا الجهاز. لم يتم إرسال عملية جديدة.', { exact: true }),
    ).toBeVisible();
    assert.equal(posts.length, expectedPosts);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: unlinked receipts and payroll: 20 clicks, committed/lost reply, changed amount blocked, exact retry after reload, one stored entry, storage fail-closed.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
