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
  await page.evaluate(() => document.fonts.ready);
  const financial = database
    .prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id')
    .all();
  const output = resolve('artifacts/fitted-amount');
  mkdirSync(output, { recursive: true });
  const measure = () =>
    amount.evaluate((input) => {
      const e = input as HTMLInputElement;
      const s = getComputedStyle(e);
      const c = document.createElement('canvas').getContext('2d')!;
      c.font = `${s.fontStyle} ${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const available = e.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) - 4;
      return {
        size: parseFloat(s.fontSize),
        available,
        text: c.measureText(e.value).width,
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
      };
    });
  for (const width of [1440, 1100, 390]) {
    await page.setViewportSize({ width, height: 950 });
    for (const level of ['medium', 'large', 'off']) {
      await page.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
      await page.locator('.ledger-panel').waitFor({ state: 'detached' });
      const button = page.getByRole('button', { name: /تكبير القراءة/ });
      while ((await button.getAttribute('data-level')) !== level) await button.click();
      await page.locator('.customer-card-main').filter({ hasText: 'اختبار ظهور القيمة' }).click();
      await amount.waitFor();
      await amount.fill('12345');
      const short = await measure();
      for (const value of ['123456', '1234567', '12345678', '123456789012', '1234567890123456']) {
        await amount.fill(value);
        const result = await measure();
        assert.equal(await amount.inputValue(), value);
        assert.ok(result.size <= short.size + 0.1, 'Longer values must not enlarge the font');
        assert.ok(
          Math.abs(result.width - short.width) < 1 && Math.abs(result.height - short.height) < 1,
          'Input geometry must not change',
        );
        if (value.length === 6) assert.ok(result.text <= result.available + 0.5, 'All six digits must fit inside the input');
        if (result.text > result.available + 0.5) {
          assert.ok(
            await page.locator('.ledger-full-amount').isVisible(),
            `${width}/${level}/${value}: full-value preview missing`,
          );
          assert.ok((await page.locator('.ledger-full-amount').textContent())!.includes(value));
        }
        if (value === '12345678' && level === 'large')
          await page.screenshot({ path: join(output, `amount-${width}.png`), fullPage: true });
        if (value.length === 16 && width === 1440 && level === 'large')
          await page.screenshot({ path: join(output, 'long-value-preview.png'), fullPage: true });
      }
      await amount.fill('12345');
      const restored = await measure();
      assert.ok(Math.abs(restored.size - short.size) < 0.2, 'Deleting digits must restore the larger font');
    }
  }
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
    'PASS fitted amount: 5–16 digits, three widths and readability levels, preserved geometry/value, shrink/regrow, overflow preview, exact financial submission.',
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  database.close();
  rmSync(folder, { recursive: true, force: true });
}
