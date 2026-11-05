import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { submitCollection } from '../src/server/domain/collections.ts';
import { createCustomer } from '../src/server/domain/customers.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, collector, assignments } = collectionFixture();
const first = submitCollection(db, collector, assignments[0], { mode: 'partial', amountUnits: 20, requestId: 'calm-first-pending' }, 'test');
submitCollection(db, collector, assignments[1], { mode: 'partial', amountUnits: 10, requestId: 'calm-second-pending' }, 'test');
const extra = createCustomer(db, admin, { name: 'حساب غير موجه للاختبار', openingBalance: 50, requestId: 'calm-unassigned' }, 'test');
const extraId = String((extra.body.customer as { id: string }).id);
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', secureCookie: false, internetRequired: false }));
const browser = await chromium.launch();
const phone = process.argv.includes('--phone'), dark = process.argv.includes('--dark');
let releaseWrite: (() => void) | undefined, releaseReads: (() => void) | undefined;
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1366, height: 950 } });
  if (dark) await context.addInitScript(() => localStorage.setItem('abdo-erp-theme', 'dark'));
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  const page = await context.newPage();
  const errors: string[] = [];
  let workspaceReads = 0, dashboardReads = 0, writes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/collections/workspace') workspaceReads++;
    if (path === '/api/collections') dashboardReads++;
    if (path.endsWith('/decision') && request.method() === 'POST') writes++;
  });
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'قسم استلامات الديون', exact: true }).click();
  const firstCard = page.locator('.board-assignment').filter({ hasText: 'Recovery customer' });
  const otherCard = page.locator('.board-assignment').filter({ hasText: 'Second customer' });
  for (const card of [firstCard, otherCard]) {
    await card.locator('.board-card-history > summary').click();
    await expect(card.getByRole('button', { name: 'اعتماد', exact: true })).toBeEnabled();
  }
  if (phone) await page.setViewportSize({ width: 390, height: 844 });
  await firstCard.scrollIntoViewIfNeeded();
  const approve = firstCard.getByRole('button', { name: 'اعتماد', exact: true });
  const otherApprove = otherCard.getByRole('button', { name: 'اعتماد', exact: true });
  const appearance = () => otherApprove.evaluate(button => {
    const box = button.getBoundingClientRect(), css = getComputedStyle(button);
    const history = button.closest('.board-card-history')!.getBoundingClientRect();
    return { w: box.width, h: box.height, opacity: css.opacity, color: css.color, background: css.backgroundImage, historyHeight: history.height };
  });
  const before = await appearance();
  const originalButton = await approve.boundingBox();
  const writeGate = new Promise<void>(done => { releaseWrite = done; });
  const readGate = new Promise<void>(done => { releaseReads = done; });
  let holdReads = false;
  await page.route(`**/api/collections/submissions/${first.id}/decision`, async route => { await writeGate; await route.continue(); });
  await page.route('**/api/collections/workspace?*', async route => { if (holdReads) await readGate; await route.continue(); });
  // Synchronous double activation also has to be safe before disabled renders.
  await approve.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(approve).toHaveAttribute('aria-busy', 'true');
  await expect(otherApprove).toBeDisabled();
  assert.deepEqual(await appearance(), before, 'Unrelated buttons and history retain their geometry and colors while locked');
  assert.deepEqual(await approve.boundingBox(), originalButton, 'The progress indicator cannot resize the pressed button');
  await expect(page.locator('.collection-board button[aria-busy="true"]')).toHaveCount(1);
  assert.equal(writes, 1);
  mkdirSync('artifacts/collection-calm-actions', { recursive: true });
  await page.screenshot({ path: `artifacts/collection-calm-actions/pending-${phone ? 'phone' : 'desktop'}-${dark ? 'dark' : 'light'}.png` });
  holdReads = true;
  releaseWrite!();
  await expect(otherCard.locator('.board-card-history')).toHaveAttribute('aria-busy', 'true');
  assert.deepEqual(await appearance(), before, 'A background read cannot insert a loading row or dim all actions');
  await expect(otherCard.getByText('جارٍ التحميل…', { exact: true })).toHaveCount(0);
  releaseReads!();
  await expect(firstCard.getByRole('button', { name: 'تأكيد استلام النقدية', exact: true })).toBeVisible();
  await expect(otherApprove).toBeEnabled();
  assert.equal(writes, 1);
  const posted = db.prepare('SELECT approved_transaction_id,status FROM collection_submissions WHERE id=?').get(first.id)!;
  assert.equal(posted.status, 'approved');
  assert.equal(db.prepare('SELECT count(*) n FROM debt_transactions WHERE id=?').get(String(posted.approved_transaction_id))!.n, 1);
  // An unrelated account event returns an identical collection snapshot. It must
  // not make all open histories refetch and blink again.
  await expect(page.locator('.collection-board')).not.toHaveAttribute('data-refreshing', 'true');
  await expect(otherCard.locator('.board-card-history')).toHaveAttribute('aria-busy', 'false');
  const beforeReads = workspaceReads, beforeDash = dashboardReads;
  const writer = await browser.newContext();
  const writerSession = createSession(db, admin.id, '1', 12);
  await writer.addCookies([{ name: 'abdo_session', value: writerSession.token, url: base }]);
  const response = await writer.request.post(`${base}/api/customers/${extraId}/transactions`, {
    headers: { origin: base, 'X-CSRF-Token': writerSession.csrfToken, 'X-Client-Api-Version': '1' },
    data: { requestId: 'calm-unrelated-change', expectedVersion: 1, type: 'debt', inputValue: 1 },
  });
  assert.ok(response.ok());
  await expect.poll(() => dashboardReads).toBeGreaterThan(beforeDash);
  await page.waitForTimeout(600);
  assert.equal(workspaceReads, beforeReads, 'Identical dashboard data does not restart workspace/history requests');
  assert.deepEqual(await appearance(), before);
  assert.deepEqual(errors, []);
  console.log('PASS: one local progress indicator, unchanged unrelated button appearance/history height, one POST/posting after double activation, live approval, quiet identical refresh.');
} finally {
  releaseWrite?.(); releaseReads?.();
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done())); db.close();
}
