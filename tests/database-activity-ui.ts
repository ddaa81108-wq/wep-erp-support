import { startDatabaseActivity } from '../src/server/db/databaseActivity.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { openDatabase } from '../src/server/db/database.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
const root = mkdtempSync(join(tmpdir(), 'monitor-ui-'));
const databasePath = join(root, 'active.sqlite');
const db = openDatabase(databasePath);
const backupDirectory = join(root, 'backups');
mkdirSync(backupDirectory);
writeFileSync(join(backupDirectory, 'abdo-erp-2026-10-13T00-00-00.sqlite'), 'fixture');
const config = loadConfig({ databasePath, backupDirectory, internetRequired: false, pushPublicKey: '' });
let clock = Date.now() - 120000;
const activity = startDatabaseActivity(db, { clock: () => clock, timers: false });
const server = createApp(db, config);
const browser = await chromium.launch();
const out = resolve('artifacts/database-activity');
mkdirSync(out, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext();
  await context.request.post(base + '/api/setup/admin', {
    data: { username: 'admin', displayName: 'مالك الاختبار', password: 'Monitor-Owner-123!' },
  });
  await context.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'admin', password: 'Monitor-Owner-123!' },
  });
  db.exec('CREATE TABLE telemetry_ui_fixture(id INTEGER)');
  for (let i = 0; i < 60; i++) {
    const count = i % 12 === 0 ? 50 : (i % 7) + 1;
    for (let j = 0; j < count; j++) db.prepare('SELECT 1').get();
    if (i % 4 === 0) db.prepare('INSERT INTO telemetry_ui_fixture VALUES(?)').run(i);
    clock += 2000;
    activity.live();
  }
  activity.flush();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const theme of ['light', 'dark'])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1050 });
      await page.goto(base + '/database-monitor');
      await page.evaluate((theme) => {
        localStorage.setItem('abdo-erp-theme', theme);
      }, theme);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'قاعدة البيانات والنسخ الاحتياطية' })).toBeVisible();
      await expect(page.getByText('abdo-erp-2026-10-13T00-00-00.sqlite', { exact: true })).toBeVisible();
      assert.ok(page.url().endsWith('/database-monitor'));
      await expect(page.getByRole('button', { name: 'تحديث الآن' })).toBeEnabled();
      await page.getByRole('button', { name: 'تحديث الآن' }).click();
      await expect(page.getByRole('button', { name: 'تحديث الآن' })).toBeEnabled();
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'page must not overflow',
      );
      await expect(
        page.getByRole('img', { name: 'معدل القراءات والكتابات الفعلي في الثانية' }),
      ).toBeVisible();
      await expect(page.getByRole('img', { name: 'عدد القراءات والكتابات خلال ساعات اليوم' })).toBeVisible();
      await page.screenshot({ path: join(out, theme + '-' + width + '.png'), fullPage: true });
    }
  const dateInput = page.getByLabel('يوم سجل النشاط');
  const today = new Date(clock + 7200000).toISOString().slice(0, 10);
  const yesterday = new Date(clock + 7200000 - 86400000).toISOString().slice(0, 10);
  await dateInput.fill(yesterday);
  await expect(
    page.getByText('لا توجد قياسات مسجّلة لهذا اليوم. يبدأ السجل من وقت تفعيل المراقبة.'),
  ).toBeVisible();
  await dateInput.fill(today);
  await expect(page.getByRole('img', { name: 'عدد القراءات والكتابات خلال ساعات اليوم' })).toBeVisible();
  await page.route('**/api/operations/database-activity/live', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: { code: 'FORBIDDEN', message: 'forbidden' } }),
    }),
  );
  await expect(page.getByText('انقطع تحديث المؤشر. لا تتوفر قراءة لحظية حاليًا.')).toBeVisible();
  await expect(page.getByRole('img', { name: 'معدل القراءات والكتابات الفعلي في الثانية' })).toHaveCount(0);
  await page.unroute('**/api/operations/database-activity/live');
  db.prepare('UPDATE users SET is_owner=0').run();
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('لمالك المنظومة فقط');
  db.prepare("UPDATE users SET role='employee'").run();
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('لمالك المنظومة فقط');
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole('button', { name: 'تسجيل الدخول', exact: true })).toBeVisible();
  assert.ok(page.url().endsWith('/database-monitor'));
  assert.deepEqual(errors, []);
  console.log(
    'PASS activity charts with measured test workload, day selection, missing history, connection failure: owner page, refresh, denied admin/employee, login route preserved, desktop/mobile light/dark, no overflow or browser errors.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(root, { recursive: true, force: true });
}
