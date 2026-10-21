import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase, inImmediateTransaction } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';
import { refreshDailyReport } from '../src/server/domain/reports/reports.ts';
import { captureFiveAmClosing, fiveAmDeadline } from '../src/server/domain/reports/fiveAmClosing.ts';
import { currentBusinessDate } from '../src/server/domain/reports/businessDates.ts';
import { treasuryDashboard } from '../src/server/domain/treasuryQueries.ts';
const folder = mkdtempSync(join(tmpdir(), 'erp-close-ui-'));
const database = openDatabase(join(folder, 'test.sqlite'));
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
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const setup = await page.request.post(base + '/api/setup/admin', {
    data: {
      username: 'admin',
      displayName: 'معاينة الإقفال — بيانات اختبار',
      password: 'Closing Preview 123!',
    },
  });
  assert.ok(setup.ok());
  const today = currentBusinessDate();
  treasuryDashboard(database, 'org-default');
  for (let i = 1; i <= 4; i++) {
    const day = new Date(Date.parse(today + 'T12:00:00Z') - i * 86400000).toISOString().slice(0, 10);
    database
      .prepare('UPDATE treasury_cash_accounts SET balance_units=?')
      .run([150000, -8000, 0, 4500][i - 1]);
    refreshDailyReport(database, 'org-default', day);
    if (i < 4) {
      const due = fiveAmDeadline(day);
      inImmediateTransaction(database, () =>
        captureFiveAmClosing(database, 'org-default', due.getTime() - 60000, new Date(due.getTime() + 10000)),
      );
    }
  }
  await page.goto(base + '/erp');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Closing Preview 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: 'التقارير الذكية', exact: true }).click();
  await page.getByRole('columnheader', { name: 'صافي الإقفال — 5 صباحًا', exact: true }).waitFor();
  const cells = page.locator('.report-closing');
  assert.equal(await cells.count(), 5);
  for (const text of ['لنا', 'علينا', 'متوازن', 'بانتظار الإقفال', 'لم يُسجّل الإقفال'])
    assert.ok(
      (await cells.allTextContents()).some((value) => value.includes(text)),
      text,
    );
  const before = database.prepare('SELECT * FROM daily_financial_closings ORDER BY business_date').all();
  await page.getByRole('button', { name: 'تحديث بيانات التقرير الآن', exact: true }).click();
  assert.deepEqual(
    database.prepare('SELECT * FROM daily_financial_closings ORDER BY business_date').all(),
    before,
  );
  const output = resolve('artifacts/report-closing');
  mkdirSync(output, { recursive: true });
  for (const width of [1920, 1366, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'Page overflow ' + width,
    );
    await page.screenshot({ path: join(output, 'report-' + width + '.png'), fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS closing UI: all five display states, previous report columns, fixed snapshots on refresh, desktop and mobile without page overflow.',
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  database.close();
  rmSync(folder, { recursive: true, force: true });
}
