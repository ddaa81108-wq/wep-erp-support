import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase, inImmediateTransaction } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';
import { createCustomer, addCustomerTransaction } from '../src/server/domain/customers.ts';

const directory = mkdtempSync(join(tmpdir(), 'abdo-zero-review-ui-'));
const database = openDatabase(join(directory, 'test.sqlite'));
const config: ServerConfig = { host: '127.0.0.1', port: 0, databasePath: ':memory:', sessionHours: 12,
  secureCookie: false, internetRequired: false, internetProbeUrls: [], internetProbeTimeoutMs: 100, internetProbeCacheMs: 100 };
const server = createApp(database, config);
const output = resolve('artifacts/zero-review');
mkdirSync(output, { recursive: true });
let browser: Browser | undefined;
const metrics: Record<string, number> = {};
const diagnostics: unknown[] = [];
try {
  await listen(server, config.host, 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  browser = await chromium.launch({ headless: true });
  const writer = await browser.newContext();
  assert.ok((await writer.request.post(base + '/api/setup/admin', { data: { username: 'admin', displayName: 'مدير الاختبار', password: 'Review Admin 123!' } })).ok());
  const login = await writer.request.post(base + '/api/auth/login', { headers: { 'X-Client-Api-Version': '1' }, data: { username: 'admin', password: 'Review Admin 123!' } });
  const csrf = (await login.json()).data.csrfToken;
  const mutate = async (path: string, data: Record<string, unknown>) => {
    const response = await writer.request.post(base + path, { headers: { 'X-Client-Api-Version': '1', 'X-CSRF-Token': csrf }, data });
    assert.ok(response.ok(), await response.text()); return (await response.json()).data;
  };
  const read = async (path: string) => (await (await writer.request.get(base + path)).json()).data;
  const row = database.prepare("SELECT * FROM users WHERE username='admin'").get()!;
  const actor: AuthenticatedUser = { id: String(row.id), username: 'admin', displayName: 'مدير الاختبار', role: 'admin',
    organizationId: String(row.organization_id), homeBranchId: String(row.home_branch_id), mustChangePassword: false,
    permissions: new Set(), sessionTokenHash: 'test', csrfHash: 'test' };
  const ids: string[] = [];
  const seededAt = performance.now();
  inImmediateTransaction(database, () => {
    for (let i = 0; i < 2000; i++) {
      const created = createCustomer(database, actor, { requestId: `load-create-${i}`, name: `عميل أداء ${String(i).padStart(4, '0')}`, openingBalance: 100 }, 'load-test');
      const id = (created.body.customer as { id: string }).id; ids.push(id);
      addCustomerTransaction(database, actor, id, { requestId: `load-debt-${i}`, expectedVersion: 1, type: 'debt', inputValue: 20, calculationMode: 'direct' }, 'load-test');
      addCustomerTransaction(database, actor, id, { requestId: `load-pay-${i}`, expectedVersion: 2, type: 'payment', inputValue: i % 4 === 0 ? 120 : i % 4 === 1 ? 130 : 20, calculationMode: 'direct' }, 'load-test');
    }
  });
  metrics.seedMs = performance.now() - seededAt;
  metrics.cards = 2000;
  metrics.movements = Number(database.prepare('SELECT COUNT(*) AS n FROM debt_transactions').get()!.n);
  const targetId = ids[1996];
  const targetName = 'عميل أداء 1996';
  const move = async (type: string, amount: number, suffix: string) => {
    const account = await read('/api/customers/' + targetId);
    return mutate('/api/customers/' + targetId + '/transactions', { requestId: 'review-ui-' + suffix,
      expectedVersion: account.version, type, inputValue: amount, calculationMode: 'direct' });
  };
  await move('debt', 10, 'initial-debt'); await move('payment', 10, 'initial-payment');
  let started = performance.now();
  const firstFeed = await read('/api/customers?filter=smart&limit=100');
  metrics.apiFirst100Ms = performance.now() - started;
  assert.equal(firstFeed.items.length, 100); assert.equal(firstFeed.totalItems, 2000);
  assert.equal(firstFeed.summary.activeCards, 1500); assert.equal(firstFeed.summary.pendingReviewCount, 500);
  await mutate('/api/users', { username: 'employee', displayName: 'موظف اختبار', password: 'Review Employee 123!', role: 'employee', permissions: ['debts.read', 'debts.write'] });
  database.prepare("UPDATE users SET must_change_password=0 WHERE username='employee'").run();
  const observer = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await observer.request.post(base + '/api/auth/login', { headers: { 'X-Client-Api-Version': '1' }, data: { username: 'admin', password: 'Review Admin 123!' } });
  const page = await observer.newPage();
  page.on('response', async response => {
    if (response.url().includes('/api/customers?') || response.url().includes('/api/event-changes?')) {
      try { const data = (await response.json()).data;
        diagnostics.push({ time: performance.now(), url: response.url(), status: response.status(),
          first: data.items?.[0]?.name, balance: data.items?.[0]?.balanceUnits, pending: data.items?.[0]?.zeroReview?.pending,
          latest: data.latest, total: data.totalItems });
      } catch { /* A cancelled request is expected during filter changes. */ }
    }
  });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  started = performance.now(); await page.goto(base + '/erp');
  const cards = page.locator('.customer-card-grid > .customer-card');
  await expect(cards).toHaveCount(100); await expect(cards.first()).toContainText(targetName);
  metrics.desktopInitialMs = performance.now() - started;
  await expect(page.locator('.active-cards-count strong')).toHaveText('1.500');
  await expect(page.locator('.pending-review-filter b')).toHaveText('500');
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 950 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) {
      await page.getByRole('button', { name: theme === 'dark' ? 'المظهر الليلي' : 'المظهر النهاري', exact: true }).click();
    }
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      if (width === 390) await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().left >= innerWidth)).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
      await expect(page.getByRole('button', { name: 'مراجعة تصفير ' + targetName, exact: true })).toBeVisible();
      assert.ok(await page.locator('.pending-review-filter').evaluate(el => {
        const box = el.getBoundingClientRect(); const parent = el.closest('.active-cards-card')!.getBoundingClientRect();
        return box.bottom <= parent.bottom && box.left >= parent.left && box.right <= parent.right;
      }), 'The complete review filter must fit inside its toolbar card.');
      await page.screenshot({ path: join(output, `admin-${theme}-${width}.png`), animations: 'disabled' });
    }
  }
  const search = page.locator('.dashboard-search input');
  started = performance.now(); await search.fill('عميل أداء 0004');
  await expect(cards).toHaveCount(1); await expect(cards).toContainText('عميل أداء 0004');
  metrics.searchMs = performance.now() - started;
  await search.fill(''); await expect(cards).toHaveCount(100);
  await page.getByRole('tab', { name: /صفر ينتظر المراجعة/ }).click();
  await expect(cards.first()).toContainText(targetName);
  await page.getByRole('button', { name: 'مراجعة تصفير ' + targetName, exact: true }).click();
  await expect(page.locator('.pending-review-filter b')).toHaveText('499');
  await expect(cards.filter({ hasText: targetName })).toHaveCount(0);
  assert.equal((await read('/api/customers/' + targetId)).zeroReview.pending, false);
  await page.getByRole('tab', { name: 'مسدد', exact: true }).click();
  await search.fill(targetName); await expect(cards).toHaveCount(1);
  await expect(cards.locator('.zero-review-status.reviewed')).toBeVisible();
  await page.screenshot({ path: join(output, 'reviewed-green.png'), animations: 'disabled' });
  await search.fill(''); await page.getByRole('tab', { name: 'الذكية', exact: true }).click();
  await expect(cards).toHaveCount(100);
  started = performance.now();
  while (await page.locator('.load-more-cards').count()) {
    const count = await cards.count();
    await page.locator('.load-more-cards').click();
    await expect(cards).toHaveCount(Math.min(count + 100, 2000));
  }
  metrics.loadAll2000Ms = performance.now() - started;
  console.log('Loaded all:', JSON.stringify(metrics));
  await expect(cards.last()).toContainText(targetName);
  await page.evaluate(() => window.scrollTo(0, 0));
  started = performance.now(); await move('debt', 15, 'promote-debt');
  await expect(cards.first()).toContainText(targetName, { timeout: 10000 });
  await expect(page.locator('.active-cards-count strong')).toHaveText('1.501');
  metrics.realtimeWith2000LoadedMs = performance.now() - started;
  console.log('Realtime all:', JSON.stringify(metrics));
  await move('payment', 15, 'zero-again');
  console.log('Payment committed:', JSON.stringify((await read('/api/customers/' + targetId)).zeroReview));
  console.log('Browser after payment:', await page.evaluate(() => ({ visibility: document.visibilityState, first: document.querySelector('.customer-card')?.textContent })));
  await expect(cards.first().locator('.zero-review-status.pending')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.pending-review-filter b')).toHaveText('500');
  await expect(page.locator('.active-cards-count strong')).toHaveText('1.500');
  await page.setViewportSize({ width: 390, height: 950 });
  started = performance.now(); await page.reload(); await expect(cards).toHaveCount(100);
  metrics.mobileInitialMs = performance.now() - started;
  started = performance.now(); await move('debt', 5, 'mobile-debt');
  await expect(cards.first().locator('.customer-balance-amount')).toHaveText('5', { timeout: 10000 });
  metrics.mobileRealtimeMs = performance.now() - started;
  await move('payment', 5, 'mobile-payment');
  await expect(cards.first().locator('.zero-review-status.pending')).toBeVisible({ timeout: 10000 });
  await page.route('**/api/customers/' + targetId + '/zero-review', async route => {
    await move('debt', 5, 'concurrent-debt'); await move('payment', 5, 'concurrent-payment');
    await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: 'مراجعة تصفير ' + targetName, exact: true }).click();
  await expect(page.locator('.alert.error')).toContainText('تغيّر الكارت');
  assert.equal((await read('/api/customers/' + targetId)).zeroReview.pending, true);
  const employee = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const employeeLogin = await employee.request.post(base + '/api/auth/login', { headers: { 'X-Client-Api-Version': '1' }, data: { username: 'employee', password: 'Review Employee 123!' } });
  const employeeCsrf = (await employeeLogin.json()).data.csrfToken;
  const forbidden = await employee.request.post(base + '/api/customers/' + targetId + '/zero-review', {
    headers: { 'X-Client-Api-Version': '1', 'X-CSRF-Token': employeeCsrf }, data: { expectedFinancialVersion: (await read('/api/customers/' + targetId)).zeroReview.financialVersion } });
  assert.equal(forbidden.status(), 403);
  const employeePage = await employee.newPage(); employeePage.on('pageerror', error => errors.push(error.message));
  await employeePage.goto(base + '/erp'); await expect(employeePage.locator('.customer-card')).toHaveCount(100);
  await expect(employeePage.locator('.zero-review-status,.pending-review-filter')).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await employeePage.setViewportSize({ width: 1440, height: 950 });
    if (await employeePage.evaluate(() => document.documentElement.dataset.theme) !== theme) await employeePage.getByRole('button', { name: theme === 'dark' ? 'المظهر الليلي' : 'المظهر النهاري', exact: true }).click();
    for (const width of [390, 1440]) {
      await employeePage.setViewportSize({ width, height: 950 });
      if (width === 390) await expect.poll(() => employeePage.locator('.sidebar').evaluate(el => el.getBoundingClientRect().left >= innerWidth)).toBe(true);
      await expect.poll(() => employeePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true);
      await employeePage.screenshot({ path: join(output, `employee-${theme}-${width}.png`), animations: 'disabled' });
    }
  }
  assert.deepEqual(errors, []);
  assert.equal((await read('/api/operations/health')).financialMismatches, 0);
  writeFileSync(join(output, 'metrics.json'), JSON.stringify(metrics, null, 2));
  console.log('PASS zero review: 2000 cards/6000 initial movements, review, promotion, paging, realtime, employee denial, both themes and viewports.');
  console.log(JSON.stringify(metrics));
} finally {
  writeFileSync(join(output, 'diagnostics.json'), JSON.stringify({ metrics, diagnostics }, null, 2));
  await browser?.close(); await new Promise<void>(done => server.close(() => done()));
  database.close(); rmSync(directory, { recursive: true, force: true });
}
