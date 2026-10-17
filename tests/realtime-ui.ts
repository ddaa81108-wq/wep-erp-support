import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser, type APIRequestContext } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';

const directory = mkdtempSync(join(tmpdir(), 'abdo-live-ui-'));
const database = openDatabase(join(directory, 'live.sqlite'));
const config: ServerConfig = {
  host: '127.0.0.1',
  port: 0,
  databasePath: ':memory:',
  sessionHours: 12,
  secureCookie: false,
  internetRequired: false,
  internetProbeUrls: [],
  internetProbeTimeoutMs: 100,
  internetProbeCacheMs: 100,
};
const server = createApp(database, config);
let browser: Browser | undefined;
try {
  await listen(server, config.host, 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  browser = await chromium.launch({ headless: true });
  const writer = await browser.newContext();
  const setup = await writer.request.post(base + '/api/setup/admin', {
    data: { username: 'admin', displayName: 'مدير الاختبار', password: 'Live Admin 123!' },
  });
  assert.ok(setup.ok(), await setup.text());
  const login = await writer.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'admin', password: 'Live Admin 123!' },
  });
  const csrf = (await login.json()).data.csrfToken as string;
  const mutate = async (path: string, data: Record<string, unknown>, method = 'POST') => {
    const result = await writer.request.fetch(base + path, {
      method,
      headers: { 'X-Client-Api-Version': '1', 'X-CSRF-Token': csrf },
      data,
    });
    assert.ok(result.ok(), await result.text());
    return (await result.json()).data;
  };
  const read = async (request: APIRequestContext, path: string) => {
    const response = await request.get(base + path);
    assert.ok(response.ok(), await response.text());
    return (await response.json()).data;
  };
  await mutate('/api/users', {
    username: 'reports',
    displayName: 'موظف التقارير',
    password: 'Live Reports 123!',
    role: 'employee',
    permissions: ['reports.read'],
  });
  database.prepare("UPDATE users SET must_change_password=0 WHERE username='reports'").run();
  const observer = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await observer.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'admin', password: 'Live Admin 123!' },
  });
  const page = await observer.newPage();
  let initialCustomerLists = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/customers') initialCustomerLists += 1;
  });
  await page.goto(base + '/erp');
  await page.locator('.debt-total-card').waitFor();
  // Allow the first SSE open and its coalescing timer to complete.
  await page.waitForTimeout(1200);
  assert.equal(initialCustomerLists, 1, 'Opening the section must not fetch the initial list twice');
  await page.evaluate(() => {
    (window as unknown as { liveMarker: string }).liveMarker = 'no-reload';
  });
  const reportsContext = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const reportLogin = await reportsContext.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'reports', password: 'Live Reports 123!' },
  });
  assert.ok(reportLogin.ok());
  const reportPage = await reportsContext.newPage();
  await reportPage.goto(base + '/erp');
  await reportPage.getByRole('button', { name: 'التقارير الذكية', exact: true }).click();
  await reportPage.locator('.reports-page').waitFor();
  const account = await mutate('/api/customers', {
    name: 'عميل المزامنة',
    openingBalance: 100,
    requestId: 'live-create-account',
  });
  const total = page.locator('.debt-total-card strong');
  const active = page.locator('.active-cards-count strong');
  await expect(total).toContainText('100', { timeout: 7000 });
  await expect(active).toHaveText('1');
  await expect(reportPage.locator('[data-label="ديون لنا"]').first()).toContainText('100', { timeout: 7000 });
  await page.locator('.customer-card-main').filter({ hasText: 'عميل المزامنة' }).click();
  await page.getByLabel('قيمة المعاملة', { exact: true }).fill('7');
  await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('مسودة لا تمسح');
  const update = await mutate('/api/customers/' + account.customer.id + '/transactions', {
    requestId: 'live-new-debt',
    expectedVersion: 1,
    type: 'debt',
    inputValue: 25,
    calculationMode: 'direct',
  });
  await expect(total).toContainText('125', { timeout: 7000 });
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('ملاحظة المعاملة', { exact: true })).toHaveValue('مسودة لا تمسح');
  await expect(reportPage.locator('[data-label="ديون لنا"]').first()).toContainText('125', { timeout: 7000 });
  await page.locator('.ledger-panel > header .icon-button').click();
  const search = page.locator('.dashboard-search input');
  await search.fill('عميل المزامنة');
  await mutate('/api/customers', { name: 'عميل آخر', openingBalance: 50, requestId: 'live-second-account' });
  await expect(total).toContainText('175', { timeout: 7000 });
  await expect(active).toHaveText('2');
  await expect(search).toHaveValue('عميل المزامنة');
  await expect(page.locator('.customer-card-main').filter({ hasText: 'عميل آخر' })).toHaveCount(0);
  await observer.setOffline(true);
  await mutate('/api/customers/' + account.customer.id + '/transactions', {
    requestId: 'live-offline-debt',
    expectedVersion: update.customerVersion,
    type: 'debt',
    inputValue: 10,
    calculationMode: 'direct',
  });
  await observer.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(total).toContainText('185', { timeout: 10000 });
  assert.equal(
    await page.evaluate(() => (window as unknown as { liveMarker: string }).liveMarker),
    'no-reload',
  );
  let failedRefreshes = 0;
  await page.route('**/api/customers?**', async route => {
    if (failedRefreshes++ === 0) await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'TEST_RETRY',message:'temporary'}})});
    else await route.continue();
  });
  await mutate('/api/customers',{name:'عميل إعادة المحاولة',openingBalance:5,requestId:'live-retry-account'});
  await expect(total).toContainText('190',{timeout:7000});
  assert.ok(failedRefreshes >= 2);
  await page.unroute('**/api/customers?**');
  const feed = await read(reportsContext.request, '/api/event-changes?after=0');
  assert.ok(feed.events.some((event: { topic: string }) => event.topic === 'financial.summary.changed'));
  for (const event of feed.events) {
    assert.equal(event.aggregateId, null);
    assert.deepEqual(event.payload, {});
  }
  assert.equal((await reportsContext.request.get(base + '/api/customers')).status(), 403);
  const zeroAccount = await mutate('/api/customers', { name: 'عميل رصيد صفر', openingBalance: 0, requestId: 'live-zero-account' });
  await expect(active).toHaveText('3');
  const negativeMovement = await mutate('/api/customers/' + zeroAccount.customer.id + '/transactions', {
    requestId: 'live-zero-to-negative', expectedVersion: 1, type: 'payment', inputValue: 10, calculationMode: 'direct',
  });
  await expect(active).toHaveText('4', { timeout: 7000 });
  const settledMovement = await mutate('/api/customers/' + zeroAccount.customer.id + '/transactions', {
    requestId: 'live-negative-to-zero', expectedVersion: negativeMovement.customerVersion, type: 'debt', inputValue: 10, calculationMode: 'direct',
  });
  await expect(active).toHaveText('3', { timeout: 7000 });
  await mutate('/api/customers/' + zeroAccount.customer.id + '/transactions', {
    requestId: 'live-zero-to-positive', expectedVersion: settledMovement.customerVersion, type: 'debt', inputValue: 10, calculationMode: 'direct',
  });
  await expect(active).toHaveText('4', { timeout: 7000 });
  await mutate('/api/users', {
    username: 'collector', displayName: 'محصل الاختبار', password: 'Live Collector 123!',
    role: 'employee', permissions: ['collections.read', 'collections.write'],
  });
  await search.fill('');
  await expect(page.locator('.customer-card-main')).toHaveCount(4);
  await page.getByRole('button', { name: 'التوجيه', exact: true }).click();
  await page.locator('.routing-bar select').selectOption({ label: 'محصل الاختبار' });
  await page.locator('.routing-select input').nth(0).check();
  await page.locator('.routing-select input').nth(1).check();
  // Overlap multiple list refreshes with the assignment event, as on a slow connection.
  await page.route('**/api/customers?**', async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'تأكيد التوجيه', exact: true }).click();
  await expect(page.locator('.routing-bar')).toHaveCount(0);
  await expect(page.locator('.alert.success')).toContainText('تم توجيه الكروت');
  await expect(page.locator('.customer-assignee-badge')).toHaveCount(2);
  await expect(page.locator('.alert.error')).toHaveCount(0);
  await page.unroute('**/api/customers?**');
  await page.getByRole('button', { name: 'أمانات ليبية', exact: true }).click();
  await mutate('/api/libyan-deposits', {
    name: 'وديعة أولى',
    openingBalance: 100,
    requestId: 'live-deposit-first',
  });
  const secondDeposit = await mutate('/api/libyan-deposits', {
    name: 'وديعة ثانية',
    openingBalance: 0,
    requestId: 'live-deposit-second',
  });
  await expect(active).toHaveText('1', { timeout: 7000 });
  await mutate('/api/libyan-deposits/' + secondDeposit.customer.id + '/transactions', {requestId:'live-deposit-withdrawal',expectedVersion:1,type:'payment',inputValue:30,calculationMode:'direct'});
  await expect(total).toContainText('70', { timeout: 7000 });
  await expect(active).toHaveText('2', { timeout: 7000 });
  await search.fill('وديعة أولى');
  await expect(page.locator('.customer-card-main')).toHaveCount(1);
  await expect(total).toContainText('70');
  await mutate('/api/egyptian-deposits', {
    name: 'وديعة مصرية',
    openingBalance: 100,
    requestId: 'live-egyptian-deposit',
  });
  await mutate('/api/egyptian-deposits/exchange-rate', { egpPerLyd: 5 }, 'PATCH');
  await expect(reportPage.locator('[data-label="المصري بالليبي"]').first()).toContainText('20', {
    timeout: 7000,
  });
  await mutate('/api/egyptian-deposits/exchange-rate', { egpPerLyd: 4 }, 'PATCH');
  await expect(reportPage.locator('[data-label="المصري بالليبي"]').first()).toContainText('25', {
    timeout: 7000,
  });
  mkdirSync(resolve('artifacts', 'realtime'), { recursive: true });
  await page.screenshot({ path: resolve('artifacts', 'realtime', 'customers-live.png') });
  await reportPage.screenshot({ path: resolve('artifacts', 'realtime', 'reports-live.png') });
  await observer.close();
  await reportsContext.close();
  await writer.close();
  console.log(
    'PASS realtime: new cards, movements, global totals under search, active count, preserved draft, reconnect, no reload, restricted reports updates with redacted events.',
  );
} finally {
  await browser?.close();
  await new Promise<void>((done) => server.close(() => done()));
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
