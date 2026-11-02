import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionBoardFixture } from './helpers/collectionBoardFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

const { db, collector, currentAssignments } = collectionBoardFixture();
const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }),
);
const browser = await chromium.launch();
const errors: string[] = [];
const directory = 'artifacts/employee-collection-board';
mkdirSync(directory, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([
    {
      name: 'abdo_session',
      value: createSession(db, collector.id, '1', 12).token,
      url: base,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  const board = page.locator('.employee-collection-board');
  await expect(board).toBeVisible();
  await expect(board.locator('.collection-grid > .collection-card')).toHaveCount(50);
  const summary = await board.locator('.employee-board-summary').innerText();
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
      for (const width of [360, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const tab of ['cards', 'history', 'cash']) {
          await page.locator('#employee-tab-' + tab).click();
          if (tab !== 'cards')
            await expect(board.locator('.employee-receipts').getByRole('status')).toHaveText(
              'متصل بالمزامنة الحية',
            );
          assert.equal(await board.locator('.employee-board-summary').innerText(), summary);
          await expect
            .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
            .toBe(true);
          assert.deepEqual(
            await board.locator('button:visible,input:visible').evaluateAll((elements) =>
              elements
                .filter((element) => {
                  const r = element.getBoundingClientRect();
                  return r.left < -2 || r.right > innerWidth + 2;
                })
                .map((element) => element.textContent),
            ),
            [],
          );
          await expect(board.getByRole('button', { name: 'اعتماد', exact: true })).toHaveCount(0);
          await expect(board.getByRole('button', { name: 'تأكيد استلام النقدية', exact: true })).toHaveCount(
            0,
          );
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#employee-tab-cards').click();
  const search = board.getByRole('textbox', { name: 'بحث بالاسم أو الهاتف', exact: true });
  await search.fill('لا يوجد هذا العميل');
  await expect(board.locator('.collection-grid > .collection-card')).toHaveCount(0);
  assert.equal(await board.locator('.employee-board-summary').innerText(), summary);
  await search.fill('');
  await expect(board.locator('.collection-grid > .collection-card')).toHaveCount(50);
  const repeated = board.locator('.collection-card').filter({ hasText: 'عميل محمد علي 009' });
  await repeated.locator('.employee-card-history > summary').click();
  await expect(repeated.locator('.employee-receipt')).toHaveCount(4);
  await expect(repeated).toContainText('تم تسليم النقدية');
  await expect(repeated).toContainText('معتمد — النقدية لم تُسلّم');
  await repeated.screenshot({ path: `${directory}/four-partials-phone.png` });
  assert.deepEqual(
    db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
    before,
  );
  const target = board.locator('.collection-card').filter({ hasText: '001' }).first();
  await target.locator('.partial-collection-details > summary').click();
  for (const [index, amount] of [25, 30, 35].entries()) {
    await target.locator('input[name="amount"]').fill(String(amount));
    await target.getByRole('button', { name: 'حفظ', exact: true }).click();
    await expect
      .poll(() =>
        Number(
          db
            .prepare('SELECT COUNT(*) n FROM collection_submissions WHERE assignment_id=?')
            .get(currentAssignments[0])!.n,
        ),
      )
      .toBe(index + 1);
    await expect(target.getByRole('button', { name: 'حفظ', exact: true })).toBeEnabled();
  }
  // Awaiting approval never changes the customer ledger or blocks the next partial collection.
  assert.deepEqual(
    db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
    before,
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    .toBe(true);
  await target.screenshot({ path: `${directory}/partial-entry-phone.png` });
  await target.locator('input[name="amount"]').fill('40');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.locator('#employee-tab-history').click();
  await expect(page.locator('#employee-tab-cards')).toHaveAttribute('aria-selected', 'true');
  await expect(target.locator('input[name="amount"]')).toHaveValue('40');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#employee-tab-history').click();
  await expect(board.locator('.employee-receipts').getByRole('status')).toHaveText('متصل بالمزامنة الحية');
  await expect(board.locator('.board-pagination')).toBeVisible();
  await board.getByRole('button', { name: 'التالي', exact: true }).click();
  await expect(board.locator('.board-pagination')).toContainText('صفحة 2');
  const own = await context.request.get(base + '/api/collections/mine?state=all&employeeId=fixture-other');
  assert.ok(own.ok());
  assert.ok(
    (await own.json()).data.items.every(
      (item: { collectorUserId: string }) => item.collectorUserId === collector.id,
    ),
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    `${directory}/results.json`,
    JSON.stringify(
      {
        screens,
        cards: 50,
        status: 'passed',
        scenarios: [
          'viewport',
          'own scope',
          'no admin actions',
          'independent partials',
          'unchanged balances',
          'history paging',
          'search totals',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS employee workspace: ${screens} visual states; repeated partials, identity scope, pagination and no financial changes before approval.`,
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  db.close();
}
