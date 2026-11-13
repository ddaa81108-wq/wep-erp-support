import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
const folder = mkdtempSync(join(tmpdir(), 'erp-fit-amount-'));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const setup = await page.request.post(base + '/api/setup/admin', {
    data: { username: 'admin', displayName: 'معاينة المبلغ', password: 'Fitted Amount 123!' },
  });
  assert.ok(setup.ok());
  const actor = fixtureAdmin(database);
  createCustomer(
    database,
    actor,
    { name: 'اختبار ظهور القيمة', openingBalance: 1000, requestId: 'fit-customer' },
    'test',
  );
  await page.goto(base + '/erp');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Fitted Amount 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await page.locator('.customer-card-main').filter({ hasText: 'اختبار ظهور القيمة' }).click();
  const amount = page.getByLabel('قيمة المعاملة', { exact: true });
  await amount.waitFor();
  // Native stepping must be blocked even for dynamically mounted, uncontrolled inputs.
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'number-arrow-regression';
    input.type = 'number';
    input.step = 'any';
    document.body.append(input);
  });
  const nativeNumber = page.locator('#number-arrow-regression');
  for (const value of ['123456', '0', '-25', '9.5']) {
    await nativeNumber.fill(value);
    for (const key of ['ArrowDown', 'ArrowUp']) {
      await nativeNumber.press(key);
      assert.equal(await nativeNumber.inputValue(), value, `${key} changed ${value}`);
    }
  }
  await nativeNumber.press('ControlOrMeta+A');
  await nativeNumber.press('7');
  assert.equal(await nativeNumber.inputValue(), '7', 'Normal typing must still work');
  await page.evaluate(() => document.getElementById('number-arrow-regression')!.remove());
  await amount.fill('123456');
  await amount.press('ArrowDown');
  assert.equal(await amount.inputValue(), '123456');
  assert.equal(await amount.evaluate((input) => document.activeElement === input), false,
    'Ledger arrow navigation must still move focus');
  await page.evaluate(() => document.fonts.ready);
  const financial = database
    .prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id')
    .all();
  const output = resolve('artifacts/fitted-amount');
  mkdirSync(output, { recursive: true });
  assert.deepEqual(
    database.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
    financial,
  );
  await page.setViewportSize({ width: 1440, height: 950 });
  await amount.fill('123456');
  await page.getByLabel('ملاحظة المعاملة', { exact: true }).fill('اختبار اعتماد المبلغ كاملًا');
  await page.getByRole('button', { name: 'اعتماد المعاملة', exact: true }).click();
  await page.locator('.ledger-record').filter({ hasText: 'اختبار اعتماد المبلغ كاملًا' }).waitFor();
  assert.equal(
    database.prepare("SELECT current_balance_units FROM customers WHERE name='اختبار ظهور القيمة'").get()!
      .current_balance_units,
    124456,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS number arrows: positive/zero/negative/fractional values unchanged, typing and ledger navigation preserved, exact financial submission.',
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  database.close();
  rmSync(folder, { recursive: true, force: true });
}
