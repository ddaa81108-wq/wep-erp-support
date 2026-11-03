import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer, addCustomerTransaction, customerLedger } from '../src/server/domain/customers.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { Ledger } from '../src/client/api.ts';

console.log('Preparing isolated ledger fixture.');
const db = openDatabase(':memory:'),
  admin = fixtureAdmin(db);
const created = createCustomer(
  db,
  admin,
  { name: 'عميل مزامنة السجل الطويل', openingBalance: 0, requestId: 'sync-window-account' },
  'test',
);
const id = String((created.body.customer as { id: string }).id);
for (let i = 1; i <= 205; i++)
  addCustomerTransaction(
    db,
    admin,
    id,
    {
      requestId: 'ledger-sync-' + i,
      expectedVersion: i,
      type: 'debt',
      inputValue: 1,
      calculationMode: 'direct',
      note: 'row-' + i,
    },
    'test',
  );
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }),
);
console.log('Launching Chromium.');
const browser = await chromium.launch();
const errors: string[] = [];
let release: (() => void) | undefined;
const directory = 'artifacts/ledger-window-sync';
mkdirSync(directory, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } }),
    writer = await browser.newContext();
  const session = createSession(db, admin.id, '1', 12),
    writeSession = createSession(db, admin.id, '1', 12);
  for (const [ctx, token] of [
    [context, session.token],
    [writer, writeSession.token],
  ] as const)
    await ctx.addCookies([
      { name: 'abdo_session', value: token, url: base, httpOnly: true, sameSite: 'Strict' },
    ]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/erp');
  await page.locator('.customer-card-main').filter({ hasText: 'عميل مزامنة السجل الطويل' }).click();
  const panel = page.locator('.ledger-panel.section-customers');
  await expect(panel.locator('.ledger-record')).toHaveCount(100);
  await panel.getByRole('button', { name: 'تحميل المعاملات الأقدم', exact: true }).click();
  await expect(panel.locator('.ledger-record')).toHaveCount(200);
  await panel.getByRole('button', { name: 'تحميل المعاملات الأقدم', exact: true }).click();
  await expect(panel.locator('.ledger-record')).toHaveCount(205);
  console.log('Loaded 205 transactions.');
  const last = panel.locator('.ledger-record .ledger-row-balance bdi').last();
  await expect(last).toHaveText('205');
  await page.getByLabel('قيمة المعاملة', { exact: true }).fill('7');
  await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('مسودة تبقى محفوظة أثناء المزامنة');
  const post = async (sequence: number, action: 'cancel' | 'corrections', extra: object = {}) => {
    const transaction = db
      .prepare('SELECT id FROM debt_transactions WHERE customer_id=? AND customer_sequence=?')
      .get(id, sequence)!;
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version);
    const response = await writer.request.post(
      `${base}/api/customers/${id}/transactions/${transaction.id}/${action}`,
      {
        headers: { 'X-CSRF-Token': writeSession.csrfToken, 'X-Client-Api-Version': '1', origin: base },
        data: {
          requestId: crypto.randomUUID(),
          expectedVersion: version,
          reason: 'اختبار تعديل قديم من جهاز آخر',
          ...extra,
        },
      },
    );
    assert.ok(response.ok(), await response.text());
  };
  let hold = true,
    held = false,
    failNext = false;
  await page.route('**/api/customers/*/ledger?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('before') && hold) {
      hold = false;
      held = true;
      await new Promise<void>((done) => {
        release = done;
      });
    } else if (url.searchParams.has('before') && failNext) {
      failNext = false;
      await route.fulfill({
        status: 503,
        json: { ok: false, error: { code: 'UNAVAILABLE', message: 'اختبار انقطاع مؤقت' } },
      });
      return;
    }
    await route.continue();
  });
  await post(1, 'cancel');
  await expect.poll(() => held, { timeout: 15000 }).toBe(true);
  // While the older page is delayed, keep the previous entire coherent snapshot.
  await expect(last).toHaveText('205');
  await expect(panel.locator('.ledger-total strong')).toContainText('205');
  release!();
  release = undefined;
  await expect(panel.locator('.ledger-record')).toHaveCount(204, { timeout: 10000 });
  await expect(last).toHaveText('204');
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('ملاحظة المعاملة', { exact: true })).toHaveValue(
    'مسودة تبقى محفوظة أثناء المزامنة',
  );
  failNext = true;
  await post(80, 'corrections', {
    type: 'debt',
    inputValue: 7,
    calculationMode: 'direct',
    note: 'row-80-corrected',
  });
  await expect(last).toHaveText('210', { timeout: 15000 });
  await expect(panel.getByText('row-80-corrected', { exact: true })).toBeVisible();
  await expect(panel.locator('.ledger-record')).toHaveCount(204);
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('7');
  assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(id)!.n, 210);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM debt_transactions WHERE customer_id=?').get(id)!.n,
    205,
    'Read retry must not write another transaction',
  );
  await page.getByLabel('قيمة المعاملة', { exact: true }).fill('');
  await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('');
  await page.screenshot({ path: `${directory}/live-old-correction.png`, animations: 'disabled' });
  await page.unroute('**/api/customers/*/ledger?*');
  // Format-only responses simulate very large signed balances without posting them.
  const source = customerLedger(
    db,
    id,
    new URL(base + '/?limit=100'),
    admin.organizationId,
  ) as unknown as Ledger;
  const amounts = [
    1234567890,
    1234567890,
    1234567890,
    Number.MAX_SAFE_INTEGER - 1234567890,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  ];
  const types = ['debt', 'payment', 'payment', 'payment', 'debt', 'debt'] as const;
  const visual = {
    ...source,
    customer: { ...source.customer, balanceUnits: Number.MAX_SAFE_INTEGER },
    pageOpeningBalanceUnits: 0,
    nextCursor: null,
    totalItems: 6,
    items: amounts.map((amount, index) => ({
      ...source.items[0],
      id: 'display-' + index,
      sequence: index + 1,
      type: types[index],
      amountUnits: amount,
      inputValue: amount,
      status: 'posted',
      note: 'بيانات عرض تجريبية فقط',
    })),
  };
  await page.route('**/api/customers/*/ledger?*', (route) =>
    route.fulfill({ json: { ok: true, data: visual } }),
  );
  await page.reload();
  await page.locator('.customer-card-main').filter({ hasText: 'عميل مزامنة السجل الطويل' }).click();
  await expect(panel.locator('.ledger-record')).toHaveCount(6);
  const assertNumbers = async () => {
    await expect
      .poll(() =>
        panel.locator('.ledger-row-balance').evaluateAll((cells) =>
          cells.flatMap((cell) => {
            const number = cell.querySelector('bdi')!,
              amount = cell.querySelector('.ledger-readable-value')!,
              box = cell.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(number);
            const rows = [...range.getClientRects()].filter((r) => r.width > 0);
            const all = document.createRange();
            all.selectNodeContents(amount);
            const bounds = all.getBoundingClientRect();
            return rows.some((row) => Math.abs(row.top - rows[0].top) > 1) ||
              bounds.left < box.left + 2 ||
              bounds.right > box.right - 2
              ? [number.textContent]
              : [];
          }),
        ),
      )
      .toEqual([]);
  };
  let screenshots = 0;
  for (const shell of ['original', '03']) {
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
    if (
      ((await page.evaluate(() => document.documentElement.dataset.royalShell)) === '03') !==
      (shell === '03')
    )
      await page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      if (await panel.isVisible())
        await page.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
      await page.setViewportSize({ width: 1440, height: 950 });
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme)
        await page
          .getByRole('button', { name: theme === 'dark' ? 'المظهر الليلي' : 'المظهر النهاري', exact: true })
          .click();
      await page.locator('.customer-card-main').filter({ hasText: 'عميل مزامنة السجل الطويل' }).click();
      await expect(panel.locator('.ledger-record')).toHaveCount(6);
      for (const width of [320, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 950 });
        await assertNumbers();
        await panel.locator('.ledger-row-balance').last().scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${directory}/${shell}-${theme}-${width}-balances.png`,
          animations: 'disabled',
        });
        screenshots++;
      }
    }
  }
  assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(id)!.n, 210);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: 205-row cross-device cancellation/correction, delayed/failed page retry, unchanged draft, no duplicate writes; ${screenshots} balance layouts including zero and signed safe-integer extremes.`,
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  release?.();
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
