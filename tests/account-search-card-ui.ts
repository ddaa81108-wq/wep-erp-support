import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountSearchFixture } from './helpers/accountSearchFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, ids, companyId, hiddenId } = accountSearchFixture();
const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const assignments = db.prepare('SELECT * FROM debt_assignments ORDER BY id').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', secureCookie: false, internetRequired: false, publicOrigin: '' }));
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  const page = await context.newPage();
  const errors: string[] = [], writes: string[] = [], ledgerReads: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/(customers|companies|collections)/.test(path) && request.method() !== 'GET') writes.push(path);
    if (/\/ledger$/.test(path)) ledgerReads.push(path);
  });
  await page.goto(base + '/erp');
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 20000 });
  const search = page.getByLabel('البحث الموحد', { exact: true });
  async function reveal(name: string, id: string, section: string, assigned: boolean) {
    ledgerReads.length = 0;
    await search.fill(name);
    await page.locator('.global-search-results > button').filter({ hasText: name }).click();
    const card = page.locator(`[data-customer-id="${id}"]`);
    await expect(page.locator('.workspace')).toHaveClass(new RegExp('active-section-' + section));
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-search-highlight', 'true');
    await expect(card).toBeInViewport();
    await expect(page.locator('.ledger-panel')).toHaveCount(0);
    if (assigned) await expect(card.locator('.customer-assignee-badge')).toContainText('fixture-collector');
    else await expect(card.locator('.customer-assignee-badge')).toHaveCount(0);
    assert.deepEqual(ledgerReads, [], 'Search does not open or fetch the ledger');
    return card;
  }
  mkdirSync('artifacts/account-search-card', { recursive: true });
  let card = await reveal('عميل بحث موجه', ids[0], 'customers', true);
  await page.screenshot({ path: 'artifacts/account-search-card/customer-desktop.png' });
  await card.locator('.customer-card-main').click();
  await expect(page.locator('.ledger-panel')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
  await reveal('شركة بحث موجهة', companyId, 'companies', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await reveal('عميل بحث مخفي', hiddenId, 'customers', false);
  card = await reveal('شركة بحث موجهة', companyId, 'companies', true);
  await page.screenshot({ path: 'artifacts/account-search-card/company-phone.png' });
  await page.getByRole('tab', { name: 'مسدد', exact: true }).click();
  await expect(card).toHaveCount(0);
  await reveal('شركة بحث موجهة', companyId, 'companies', true);
  await reveal('شركة بحث موجهة', companyId, 'companies', true);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(), before);
  assert.deepEqual(db.prepare('SELECT * FROM debt_assignments ORDER BY id').all(), assignments);
  console.log('PASS search cards: cross-section, beyond page one, hidden zero, repeat search, phone/desktop, manual ledger opening; balances and assignments unchanged.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done())); db.close();
}
