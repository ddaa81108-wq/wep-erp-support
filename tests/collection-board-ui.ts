import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionBoardFixture } from './helpers/collectionBoardFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';

const fixture = collectionBoardFixture();
const { db, admin, collector, other, batch, customerIds } = fixture;
const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }),
);
const browser = await chromium.launch();
const errors: string[] = [];
const directory = 'artifacts/collection-board';
mkdirSync(directory, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    {
      name: 'abdo_session',
      value: createSession(db, admin.id, '1', 12).token,
      url: base,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  const board = page.locator('.collection-board');
  const idle = async () => {
    await expect(board.getByRole('status').first()).toHaveText('متصل بالمزامنة الحية');
  };
  await idle();
  await expect(board.getByRole('tab').first()).toHaveAttribute('id', 'board-tab-all');
  await expect(page.locator('#board-tab-all')).toHaveAttribute('aria-selected', 'true');
  await expect(
    board.locator('.board-batch-actions').getByRole('button', { name: 'إغلاق ومسح الدفعة', exact: true }),
  ).toHaveCount(1);
  await expect(board.locator('.collection-overview-header')).toHaveCount(0);
  const summary = () => board.locator('.collection-board-summary').innerText();
  const originalSummary = await summary();
  const assertWholeBalances = async () => {
    await expect
      .poll(
        () =>
          board.locator('.board-current-balance bdi').evaluateAll((numbers) =>
            numbers.flatMap((number) => {
              const card = number.closest('.board-assignment')!.getBoundingClientRect();
              const range = document.createRange();
              range.selectNodeContents(number);
              const bounds = range.getBoundingClientRect();
              const rows = [...range.getClientRects()].filter((rect) => rect.width > 0);
              const wrapped = rows.some((rect) => Math.abs(rect.top - rows[0].top) > 1);
              return wrapped || bounds.left < card.left + 5 || bounds.right > card.right - 5
                ? [{ text: number.textContent, wrapped, width: bounds.width, cardWidth: card.width }]
                : [];
            }),
          ),
        {
          message: 'Every balance must remain one complete, unclipped number after responsive layout settles',
        },
      )
      .toEqual([]);
  };
  const tabs = ['review', 'cash', 'all', 'previous'];
  let screens = 0;
  for (const shell of ['original', '03']) {
    if (
      ((await page.evaluate(() => document.documentElement.dataset.royalShell)) === '03') !==
      (shell === '03')
    )
      await page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true }).click();
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme)
        await page
          .getByRole('button', { name: theme === 'dark' ? 'المظهر الليلي' : 'المظهر النهاري', exact: true })
          .click();
      for (const width of [360, 390, 768, 1024, 1440, 1920]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width >= 768) {
          const ratio = await board
            .locator('.collection-board-summary')
            .evaluate(
              (el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width,
            );
          assert.ok(ratio > 0.99 && ratio < 1.01, 'Summary spans the workspace width');
        }
        if (width >= 1024) {
          const batchBox = await board.getByLabel('دفعة العمل', { exact: true }).boundingBox();
          const payrollBox = await board.getByRole('button', { name: 'المرتبات', exact: true }).boundingBox();
          assert.ok(
            batchBox &&
              payrollBox &&
              Math.abs(batchBox.y + batchBox.height / 2 - (payrollBox.y + payrollBox.height / 2)) < 12,
            'Batch and actions share one row',
          );
          for (const control of [
            board.getByLabel('الموظف', { exact: true }),
            board.getByLabel('بحث في الاستلامات', { exact: true }),
            board.getByRole('button', { name: 'كشف PDF للدفعة', exact: true }),
            board.getByRole('button', { name: 'إغلاق ومسح الدفعة', exact: true }),
          ]) {
            const rect = await control.boundingBox();
            assert.ok(
              batchBox && rect && Math.abs(rect.y + rect.height / 2 - batchBox.y - batchBox.height / 2) < 12,
              'Every desktop filter/action shares one row',
            );
          }
        }
        for (const tab of tabs) {
          await page.locator('#board-tab-' + tab).click();
          await idle();
          assert.equal(await summary(), originalSummary, 'Tabs must not change the financial scope');
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
            .toBe(true);
          const outside = await board
            .locator('button:visible,input:visible,select:visible')
            .evaluateAll((elements) =>
              elements
                .filter((element) => {
                  const r = element.getBoundingClientRect();
                  return r.left < -2 || r.right > innerWidth + 2;
                })
                .map((element) => element.outerHTML.slice(0, 120)),
            );
          assert.deepEqual(outside, [], `${shell}/${theme}/${width}/${tab}: controls outside viewport`);
          if (tab === 'all') {
            await expect(board.locator('.board-assignment')).toHaveCount(200);
            await expect(board.locator('.board-current-balance bdi')).toHaveCount(200);
            await assertWholeBalances();
          }
          if (tab === 'previous') await expect(board.locator('.outstanding-cash-row')).toHaveCount(2);
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({
            path: `${directory}/${shell}-${theme}-${width}-${tab}.png`,
            animations: 'disabled',
          });
          screens++;
        }
      }
    }
  }
  // UI-only responses exercise the full signed safe-integer display range. The
  // financial fixture is deliberately not modified by these presentation cases.
  const dashboardResponse = await context.request.get(base + '/api/collections');
  const dashboard = (await dashboardResponse.json()).data;
  const values = [0, 1, -1, 1234567890, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER];
  const extremeDashboard = {
    ...dashboard,
    assignments: dashboard.assignments.slice(0, values.length).map((item: object, index: number) => ({
      ...item,
      balanceUnits: values[index],
      customerName: 'اسم عميل طويل جدًا لاختبار وضوح الرصيد كاملًا دون قص أو كسر ' + index,
    })),
  };
  await page.route('**/api/collections', (route) =>
    route.fulfill({ json: { ok: true, data: extremeDashboard } }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await expect(board.locator('.board-assignment')).toHaveCount(values.length);
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertWholeBalances();
    await page.screenshot({
      path: `${directory}/unbroken-signed-balances-${width}.png`,
      animations: 'disabled',
    });
  }
  await page.unroute('**/api/collections');
  await page.reload();
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  await expect(board.locator('.board-assignment')).toHaveCount(200);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('#board-tab-all').click();
  await idle();
  const partialCard = board.locator('.board-assignment').filter({ hasText: 'عميل محمد علي 004' });
  await partialCard.locator('summary').click();
  await expect(partialCard.locator('.board-receipt')).toHaveCount(4);
  await expect(partialCard.locator('.board-received')).toHaveCount(1);
  await expect(partialCard.getByRole('button', { name: 'تأكيد استلام النقدية', exact: true })).toHaveCount(3);
  await partialCard.screenshot({ path: `${directory}/four-independent-partials.png` });
  await board.getByLabel('بحث في الاستلامات', { exact: true }).fill('لا يوجد هذا الاسم');
  await expect(board.locator('.board-assignment')).toHaveCount(0);
  await idle();
  assert.equal(await summary(), originalSummary);
  await board.getByLabel('بحث في الاستلامات', { exact: true }).fill('');
  await idle();
  const employee = board.getByLabel('الموظف', { exact: true });
  await employee.selectOption(collector.id);
  await idle();
  const firstSummary = await summary();
  assert.notEqual(firstSummary, originalSummary);
  await expect(board.locator('.board-assignment')).toHaveCount(50);
  await employee.selectOption(other.id);
  await idle();
  assert.notEqual(await summary(), firstSummary, 'Two people with the same name remain separate IDs');
  await employee.selectOption('');
  await idle();
  await page.route('**/api/collections/workspace?*', (route) =>
    route.fulfill({
      status: 503,
      json: { ok: false, error: { code: 'UNAVAILABLE', message: 'تعذر تحميل العرض التجريبي' } },
    }),
  );
  await page.locator('#board-tab-cash').click();
  await expect(board.getByRole('alert')).toBeVisible();
  await expect(board.getByRole('status').first()).toHaveText('تعذر تحديث العرض');
  await page.screenshot({ path: `${directory}/read-failure-retry.png` });
  await page.unroute('**/api/collections/workspace?*');
  await board.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await idle();
  await expect(board.getByRole('alert')).toHaveCount(0);
  await page.locator('#board-tab-cash').click();
  await idle();
  await board.getByRole('button', { name: 'التالي', exact: true }).click();
  await idle();
  await expect(board.locator('.board-pagination')).toContainText('صفحة 2');
  const snapshot = await context.request.get(
    base + '/api/collections/workspace?batchId=' + batch.id + '&state=all&export=1',
  );
  assert.ok(snapshot.ok());
  assert.ok((await snapshot.json()).data.items.length > 200);
  const employeeContext = await browser.newContext();
  await employeeContext.addCookies([
    {
      name: 'abdo_session',
      value: createSession(db, collector.id, '1', 12).token,
      url: base,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  assert.equal(
    (await employeeContext.request.get(base + '/api/collections/workspace?batchId=' + batch.id)).status(),
    403,
  );
  // All visual browsing and filtering is read-only, including the new endpoint.
  assert.deepEqual(
    db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
    before,
  );
  assert.equal(reconcileFinancials(db).status, 'matched');
  // Receiving cash changes the receipt state, never re-posts a customer payment.
  await board.getByRole('button', { name: 'تأكيد استلام النقدية', exact: true }).first().click();
  await idle();
  assert.deepEqual(
    db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
    before,
  );
  await page.locator('#board-tab-review').click();
  await idle();
  const pendingBefore = db
    .prepare("SELECT count(*) n FROM collection_submissions WHERE status='pending'")
    .get()!.n;
  await board.locator('.board-receipt').getByRole('button', { name: 'اعتماد', exact: true }).first().click();
  await expect
    .poll(() => db.prepare("SELECT count(*) n FROM collection_submissions WHERE status='pending'").get()!.n)
    .toBe(Number(pendingBefore) - 1);
  await idle();
  assert.equal(reconcileFinancials(db).status, 'matched');
  await board.getByRole('button', { name: 'إغلاق ومسح الدفعة', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'نعم، امسح الدفعة', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('dialog')).toContainText('توجد عمليات تنتظر الاعتماد');
  assert.ok(customerIds.length === 200);
  assert.deepEqual(errors, []);
  writeFileSync(
    `${directory}/results.json`,
    JSON.stringify(
      {
        screens,
        widths: [360, 390, 768, 1024, 1440, 1920],
        themes: ['light', 'dark'],
        shells: ['original', '03'],
        cards: 200,
        results: 'passed',
        scenarios: [
          'tabs',
          'no overflow',
          'scope totals',
          'duplicate staff names',
          'four partials',
          'pagination',
          'admin-only API',
          'cash does not repost',
          'approval reconciliation',
          'pending closure blocked',
        ],
      },
      null,
      2,
    ),
  );
  console.log(`PASS: ${screens} visual states and financial/filter/permission/action checks.`);
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
