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
const server = createApp(db, config);
const browser = await chromium.launch();
const out = resolve('artifacts/database-monitor');
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
      await page.screenshot({ path: join(out, theme + '-' + width + '.png'), fullPage: true });
    }
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
    'PASS monitor: owner page, refresh, denied admin/employee, login route preserved, desktop/mobile light/dark, no overflow or browser errors.',
  );
} finally {
  await browser.close();
  server.closeRealtimeConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(root, { recursive: true, force: true });
}
