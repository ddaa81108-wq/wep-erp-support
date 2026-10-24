import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { reportOverviewFixture } from './helpers/reportOverviewFixture.ts';
import { reportOverview } from '../src/server/domain/reports/reportOverview.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig, API_VERSION } from '../src/server/config.ts';

const { db, admin, customerId } = reportOverviewFixture();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const browser = await chromium.launch({ headless: true });
const output = resolve('artifacts/report-overview');
mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const session = createSession(db, admin.id, 'test', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  const errors: string[] = [];
  const writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/reports') && request.method() !== 'GET') writes.push(request.url()); });
  await page.goto(base + '/erp');
  await page.locator('.sidebar').getByRole('button', { name: 'التقارير الذكية', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'موقفك المالي، بوضوح' })).toBeVisible();
  const initial = reportOverview(db, admin.organizationId);
  const formatted = (value: number) => new Intl.NumberFormat('en-US').format(value);
  await expect(page.getByTestId('report-net')).toContainText(formatted(initial.position.netUnits!));
  await expect(page.locator('.report-source')).toHaveCount(6);
  await page.getByText('فتح تفاصيل المعاملات', { exact: true }).click();
  await expect(page.locator('.report-activity-table')).toBeVisible();
  await page.getByText('فتح تفاصيل المعاملات', { exact: true }).click();
  await page.locator('.report-source').filter({ hasText: 'حسابات العملاء' }).click();
  await expect(page.getByRole('dialog')).toContainText('مؤسسة الأفق — بيانات تجريبية');
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.locator('.report-source').filter({ hasText: 'الأمانات المصرية' }).click();
  await expect(page.getByRole('dialog')).toContainText('مرتبط بمصدره — محسوب مرة واحدة');
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(customerId)!.version);
  const writerSession = createSession(db, admin.id, API_VERSION, 12);
  const writer = await browser.newContext();
  await writer.addCookies([{ name: 'abdo_session', value: writerSession.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  const liveWrite = await writer.request.post(base + `/api/customers/${customerId}/transactions`, {
    headers: { origin: base, 'x-csrf-token': writerSession.csrfToken, 'x-client-api-version': API_VERSION },
    data: { requestId: 'overview-ui-live-debt', expectedVersion: version, type: 'debt', inputValue: 50, date: new Date().toISOString() },
  });
  assert.equal(liveWrite.status(), 201, await liveWrite.text());
  await writer.close();
  await expect(page.getByTestId('report-net')).toContainText(formatted(initial.position.netUnits! + 50), { timeout: 20_000 });
  const currentNet = await page.getByTestId('report-net').textContent();
  await page.route('**/api/reports/overview', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: { code: 'TEST_REFRESH_FAILURE', message: 'Preview refresh unavailable' } }) }));
  await page.getByRole('button', { name: 'تحديث بيانات التقرير الآن', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('report-net')).toHaveText(currentNet!);
  await page.unroute('**/api/reports/overview');
  await page.getByRole('button', { name: 'تحديث بيانات التقرير الآن', exact: true }).click();
  await expect(page.locator('.report-reading-error')).toHaveCount(0);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${theme} overflow at ${width}`);
      await page.screenshot({ path: resolve(output, `${theme}-${width}.png`), fullPage: true });
      if (width === 390) {
        await page.getByText('فتح تفاصيل المعاملات', { exact: true }).click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: resolve(output, `${theme}-390-details.png`), fullPage: true });
        await page.getByText('فتح تفاصيل المعاملات', { exact: true }).click();
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'مقارنة بالتقرير السابق', exact: true }).click();
  await expect(page.locator('.reports-table')).toBeVisible();
  await page.getByRole('button', { name: 'العودة للوحة الجديدة', exact: true }).click();
  await expect(page.locator('.financial-overview')).toBeVisible();
  await page.goto(base + '/erp?lang=en');
  await page.locator('.sidebar').getByRole('button', { name: 'Smart reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your financial position, clearly' })).toBeVisible();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: resolve(output, 'english-1440.png'), fullPage: true });
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  await context.close();
  console.log('PASS overview UI: exact figures, details, live refresh, retained data on error, old/new comparison, both themes, mobile and English; report requests are GET only.');
} finally {
  await browser.close();
  await new Promise<void>(done => server.close(() => done()));
  db.close();
}
