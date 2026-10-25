import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { reportOverviewFixture } from './helpers/reportOverviewFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin } = reportOverviewFixture();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const browser = await chromium.launch({ headless: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext();
  const session = createSession(db, admin.id, 'test', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  const page = await context.newPage();
  let mode: 'ok' | 'slow' | 'offline' = 'ok';
  let slowCompleted = 0;
  let documents = 0;
  let writes = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents++;
    if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method())) writes++;
  });
  await page.route('**/api/health', async route => {
    if (mode === 'offline') { await route.abort('internetdisconnected'); return; }
    if (mode === 'slow') {
      await new Promise(resolve => setTimeout(resolve, 7_000));
      await route.fulfill({ json: { ok: true, data: { status: 'ready' } } });
      slowCompleted++;
      return;
    }
    await route.fulfill({ json: { ok: true, data: { status: 'ready' } } });
  });
  await page.goto(base + '/erp');
  const search = page.getByRole('textbox', { name: 'البحث الموحد', exact: true });
  await expect(search).toBeVisible({ timeout: 30_000 });
  await search.fill('مسودة اختبار اتصال');
  const initialDocuments = documents;
  const initialWrites = writes;
  mode = 'slow';
  await expect.poll(() => slowCompleted, { timeout: 75_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator('.connection-notice')).toHaveCount(0);
  await expect(search).toHaveValue('مسودة اختبار اتصال');
  console.log('PASS: three 7-second health responses do not show a false outage.');
  mode = 'offline';
  await expect(page.locator('.connection-notice')).toBeVisible({ timeout: 60_000 });
  await expect(search).toHaveValue('مسودة اختبار اتصال');
  mode = 'ok';
  await expect(page.locator('.connection-notice')).toHaveCount(0, { timeout: 30_000 });
  await expect(search).toHaveValue('مسودة اختبار اتصال');
  assert.equal(documents, initialDocuments, 'no full page reload on outage or recovery');
  assert.equal(writes, initialWrites, 'health retries must never replay financial writes');
  assert.deepEqual(errors, []);
  console.log('PASS: sustained outage still warns, recovery clears notice, draft survives, no reload or write replay.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
}
