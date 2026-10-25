import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { reportOverviewFixture } from './helpers/reportOverviewFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig, API_VERSION } from '../src/server/config.ts';

const { db, admin, collector, customerId } = reportOverviewFixture();
const stamp = new Date().toISOString();
for (const permission of ['debts.read', 'debts.write', 'purchases.read', 'purchases.write'])
  db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(collector.id, permission, stamp);
db.prepare('INSERT OR REPLACE INTO notification_preferences(user_id,sound_enabled,speech_enabled,updated_at) VALUES(?,0,1,?)').run(admin.id, stamp);
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const browser = await chromium.launch({ headless: true });
const releasePending = new Set<() => void>();
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const observer = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const adminSession = createSession(db, admin.id, API_VERSION, 12);
  await observer.addCookies([{ name: 'abdo_session', value: adminSession.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  // Disable periodic notification safety reads, proving that live invalidation
  // and retry work without waiting for the four-second poll to conceal a gap.
  await observer.addInitScript(() => {
    const NativeSource = window.EventSource;
    const sources: EventSource[] = [];
    (window as unknown as { syncSources: EventSource[] }).syncSources = sources;
    window.EventSource = class extends NativeSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options); sources.push(this);
      }
    };
    const interval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      interval(delay === 4_000 ? () => {} : handler, delay, ...args)) as typeof window.setInterval;
    (window as unknown as { syncSpeech: string[] }).syncSpeech = [];
    Object.defineProperty(window.speechSynthesis, 'speak', { value: (utterance: SpeechSynthesisUtterance) => {
      (window as unknown as { syncSpeech: string[] }).syncSpeech.push(utterance.text);
    } });
  });
  const page = await observer.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/erp');
  await expect(page.locator('.debt-total-card')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'الإشعارات', exact: true }).click();
  await expect(page.locator('.notification-toggle').filter({ hasText: 'النطق' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.locator('.customer-card-main').filter({ hasText: 'مؤسسة الأفق' }).click();
  await page.getByLabel('قيمة المعاملة', { exact: true }).fill('7');
  await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('مسودة الإدارة لا تمسح');
  const writer = await browser.newContext();
  const staffSession = createSession(db, collector.id, API_VERSION, 12);
  await writer.addCookies([{ name: 'abdo_session', value: staffSession.token, url: base, httpOnly: true, sameSite: 'Strict' }]);
  let sequence = 0;
  const write = async () => {
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(customerId)!.version);
    const response = await writer.request.post(`${base}/api/customers/${customerId}/transactions`, {
      headers: { origin: base, 'x-csrf-token': staffSession.csrfToken, 'x-client-api-version': API_VERSION },
      data: { requestId: `notification-sync-${++sequence}`, expectedVersion: version, type: 'debt', inputValue: sequence, note: `sync-operation-${sequence}`, date: new Date().toISOString() },
    });
    assert.equal(response.status(), 201, await response.text());
    return Number(db.prepare('SELECT MAX(id) id FROM notifications WHERE recipient_user_id=?').get(admin.id)!.id);
  };
  // Observe exact server IDs in responses and visible spoken announcements.
  let latest = 0;
  page.on('response', response => {
    if (new URL(response.url()).pathname === '/api/notifications' && response.ok())
      void response.json().then(payload => { latest = Math.max(latest, payload.data.items[0]?.id ?? 0); }).catch(() => undefined);
  });
  const first = await write();
  const firstAt = Date.now();
  await expect.poll(() => latest, { timeout: 3_000, intervals: [25, 50] }).toBeGreaterThanOrEqual(first);
  await expect(page.getByRole('button', { name: 'إشعار جديد', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { syncSpeech: string[] }).syncSpeech.length), { timeout: 3_000 }).toBeGreaterThan(0);
  await expect(page.locator('.ledger-record').filter({ hasText: 'sync-operation-1' })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByLabel('ملاحظة المعاملة', { exact: true })).toBeFocused();
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('ملاحظة المعاملة', { exact: true })).toHaveValue('مسودة الإدارة لا تمسح');
  console.log(`Live staff save -> admin notification and speech dispatch: ${Date.now() - firstAt} ms`);

  let release!: () => void;
  let holding = false;
  let intercepted = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  releasePending.add(() => release());
  await page.route('**/api/notifications', async route => {
    if (!intercepted) {
      intercepted = true;
      const stale = await route.fetch();
      holding = true;
      await held;
      await route.fulfill({ response: stale });
    } else await route.continue();
  });
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => holding).toBe(true);
  const second = await write();
  // Let the second event reach the notification subscriber while the older
  // safety read is still in flight. Its invalidation must not be acknowledged early.
  await page.waitForTimeout(200);
  release();
  const releasedAt = Date.now();
  await expect.poll(() => latest, { timeout: 2_000, intervals: [25, 50] }).toBeGreaterThanOrEqual(second);
  console.log(`In-flight stale read -> fresh admin notification: ${Date.now() - releasedAt} ms`);
  await page.unroute('**/api/notifications');

  let rejected = false;
  await page.route('**/api/notifications', async route => {
    if (!rejected) { rejected = true; await route.fulfill({ status: 503, json: { ok: false, error: { code: 'TEST_READ_FAILURE', message: 'Retry test' } } }); }
    else await route.continue();
  });
  const third = await write();
  const retryAt = Date.now();
  await expect.poll(() => latest, { timeout: 3_000, intervals: [50, 100] }).toBeGreaterThanOrEqual(third);
  assert.ok(rejected);
  console.log(`Failed notification read -> automatic live retry: ${Date.now() - retryAt} ms`);
  // Isolate the error-event recovery path from native reconnect and timer polling.
  await page.evaluate(() => {
    for (const source of (window as unknown as { syncSources: EventSource[] }).syncSources) source.close();
  });
  let releaseList!: () => void;
  const slowList = new Promise<void>(resolve => { releaseList = resolve; });
  releasePending.add(() => releaseList());
  await page.route('**/api/customers?*', async route => { await slowList; await route.continue(); });
  const fourth = await write();
  const recoveryAt = Date.now();
  await page.evaluate(() => {
    for (const source of (window as unknown as { syncSources: EventSource[] }).syncSources) source.dispatchEvent(new Event('error'));
  });
  await expect.poll(() => latest, { timeout: 2_000, intervals: [25, 50] }).toBeGreaterThanOrEqual(fourth);
  await expect(page.locator('.ledger-record').filter({ hasText: 'sync-operation-4' })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('7');
  await expect(page.getByLabel('ملاحظة المعاملة', { exact: true })).toHaveValue('مسودة الإدارة لا تمسح');
  releaseList();
  await page.unroute('**/api/customers?*');
  console.log(`Interrupted live channel -> immediate recovery read: ${Date.now() - recoveryAt} ms`);
  const row = db.prepare('SELECT current_balance_units FROM customers WHERE id=?').get(customerId)!;
  const formatted = new Intl.NumberFormat('ar-LY').format(Number(row.current_balance_units));
  await expect(page.locator('.customer-card-main').filter({ hasText: 'مؤسسة الأفق' })).toContainText(formatted);
  const editBaseline = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(customerId)!.version);
  await page.locator('.ledger-record').filter({ hasText: 'sync-operation-1' }).getByRole('button', { name: /^تعديل المعاملة/ }).click();
  const editForm = page.locator('.ledger-draft-row:not([data-new-ledger-draft])');
  await editForm.getByLabel('قيمة المعاملة', { exact: true }).fill('9');
  await write();
  await page.evaluate(() => {
    for (const source of (window as unknown as { syncSources: EventSource[] }).syncSources) source.dispatchEvent(new Event('error'));
  });
  await expect(page.locator('.ledger-record').filter({ hasText: 'sync-operation-5' })).toBeVisible({ timeout: 2_000 });
  await expect(editForm.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('9');
  const editResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/corrections'));
  await editForm.getByRole('button', { name: 'اعتماد المعاملة', exact: true }).click();
  const conflict = await editResponse;
  assert.equal(conflict.status(), 409);
  assert.equal(conflict.request().postDataJSON().expectedVersion, editBaseline);
  await expect(editForm.locator('.draft-error')).toContainText('ألغِ التعديل');
  page.once('dialog', dialog => void dialog.accept());
  await editForm.getByRole('button', { name: 'إلغاء المسودة', exact: true }).click();
  const beforeOwnSave = Number(db.prepare('SELECT current_balance_units FROM customers WHERE id=?').get(customerId)!.current_balance_units);
  const savedDraft = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith(`/api/customers/${customerId}/transactions`));
  await page.locator('[data-new-ledger-draft]').getByRole('button', { name: 'اعتماد المعاملة', exact: true }).click();
  assert.equal((await savedDraft).status(), 201);
  await expect(page.locator('.ledger-record').filter({ hasText: 'مسودة الإدارة لا تمسح' })).toBeVisible();
  await expect(page.getByLabel('قيمة المعاملة', { exact: true })).toHaveValue('');
  assert.equal(Number(db.prepare('SELECT current_balance_units FROM customers WHERE id=?').get(customerId)!.current_balance_units), beforeOwnSave + 7);
  await page.reload();
  await page.getByRole('button', { name: 'قسم المشتريات', exact: true }).click();
  const purchaseDraft = page.locator('.purchase-inline-editor:has([data-new-value])');
  await purchaseDraft.getByLabel('القيمة ج.م', { exact: true }).fill('777');
  await purchaseDraft.getByLabel('سعر الصرف', { exact: true }).fill('2');
  const purchaseWrite = async (label: string) => {
    const current = await (await writer.request.get(`${base}/api/purchases/al_bayan?limit=100`)).json();
    const result = await writer.request.post(`${base}/api/purchases/al_bayan`, {
      headers: { origin: base, 'x-csrf-token': staffSession.csrfToken, 'x-client-api-version': API_VERSION },
      data: { requestId: crypto.randomUUID(), expectedDayVersion: current.data.day.version, itemCode: 'custom', itemLabel: label,
        egpValueUnits: 400, calculationMode: 'divide', exchangeRate: '2', paidUnits: 10, vodafoneConsumedUnits: 0 },
    });
    assert.equal(result.status(), 201, await result.text());
  };
  await purchaseWrite('شراء موظف متزامن');
  const purchaseAt = Date.now();
  const purchaseRow = page.locator('.purchase-row').filter({ hasText: 'شراء موظف متزامن' });
  await expect(purchaseRow).toBeVisible({ timeout: 2_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { syncSpeech: string[] }).syncSpeech.some(text => text.includes('شراء موظف متزامن'))), { timeout: 2_000 }).toBe(true);
  await expect(purchaseDraft.getByLabel('القيمة ج.م', { exact: true })).toHaveValue('777');
  await expect(purchaseDraft.getByLabel('سعر الصرف', { exact: true })).toHaveValue('2');
  const purchaseCurrent = await (await writer.request.get(`${base}/api/purchases/al_bayan?limit=100`)).json();
  await expect(page.locator('.purchase-metrics article').filter({ hasText: 'إجمالي الديون' }).locator('b'))
    .toContainText(new Intl.NumberFormat('en-US').format(purchaseCurrent.data.day.totalDebtUnits));
  console.log(`Staff purchase -> spoken notice, saved row and totals while draft is dirty: ${Date.now() - purchaseAt} ms`);
  await purchaseRow.getByRole('button', { name: 'تعديل', exact: true }).click();
  const purchaseEdit = page.locator('.purchase-inline-editor:not(:has([data-new-value]))');
  await purchaseEdit.getByLabel('القيمة ج.م', { exact: true }).fill('999');
  await purchaseWrite('شراء موظف ثانٍ أثناء التعديل');
  await expect(page.locator('.purchase-row').filter({ hasText: 'شراء موظف ثانٍ أثناء التعديل' })).toBeVisible({ timeout: 2_000 });
  await expect(purchaseEdit.getByLabel('القيمة ج.م', { exact: true })).toHaveValue('999');
  const purchaseConflict = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/api/purchases/'));
  await purchaseEdit.getByRole('button', { name: 'اعتماد الصف', exact: true }).click();
  const purchaseRejected = await purchaseConflict;
  assert.equal(purchaseRejected.status(), 409);
  assert.equal(purchaseRejected.request().postDataJSON().expectedDayVersion, purchaseCurrent.data.day.version);
  await expect(purchaseDraft.getByLabel('القيمة ج.م', { exact: true })).toHaveValue('777');
  assert.deepEqual(errors, []);
  await writer.close();
  console.log('PASS: spoken notices, ledger and purchase rows/totals while typing, slow-list isolation, preserved drafts, edit conflicts and live retries without safety polling.');
} finally {
  for (const release of releasePending) release();
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
}
