import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser, type APIRequestContext } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';

const directory = mkdtempSync(join(tmpdir(), 'abdo-live-ui-'));
const database = openDatabase(join(directory, 'live.sqlite'));
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
mkdirSync('artifacts/treasury', { recursive: true });
let browser: Browser | undefined;
try {
  await listen(server, config.host, 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  browser = await chromium.launch({ headless: true });
  const originalNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await originalNewContext(...args);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/api/')) return route.continue();
      const file = resolve(
        process.env.ABDO_UI_WEB_ROOT ?? 'dist/web',
        url.pathname.startsWith('/assets/') ? '.' + url.pathname : 'index.html',
      );
      return route.fulfill({ path: file });
    });
    return context;
  };
  const writer = await browser.newContext();
  const setup = await writer.request.post(base + '/api/setup/admin', {
    data: { username: 'admin', displayName: 'مدير الاختبار', password: 'Live Admin 123!' },
  });
  assert.ok(setup.ok(), await setup.text());
  const login = await writer.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'admin', password: 'Live Admin 123!' },
  });
  const csrf = (await login.json()).data.csrfToken as string;
  const mutate = async (path: string, data: Record<string, unknown>, method = 'POST') => {
    const result = await writer.request.fetch(base + path, {
      method,
      headers: { 'X-Client-Api-Version': '1', 'X-CSRF-Token': csrf },
      data,
    });
    assert.ok(result.ok(), await result.text());
    return (await result.json()).data;
  };
  const read = async (request: APIRequestContext, path: string) => {
    const response = await request.get(base + path);
    assert.ok(response.ok(), await response.text());
    return (await response.json()).data;
  };
  let version = (await read(writer.request, '/api/treasury')).cashVersion;
  let serial = 0;
  const add = async () => {
    serial++;
    const result = await mutate('/api/treasury/cash-entries', {
      requestId: crypto.randomUUID(),
      expectedVersion: version,
      direction: serial % 2 ? 'in' : 'out',
      amountUnits: serial % 2 ? 200 : 50,
      description: 'حركة اختبار ' + serial,
    });
    version = result.cashVersion;
  };
  for (let i = 0; i < 205; i++) await add();
  await mutate('/api/users', {
    username: 'reader',
    displayName: 'موظف قراءة',
    password: 'Reader Test 123!',
    role: 'employee',
    permissions: ['treasury.read'],
  });
  database.prepare("UPDATE users SET must_change_password=0 WHERE username='reader'").run();
  const viewer = await browser.newContext();
  await viewer.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'admin', password: 'Live Admin 123!' },
  });
  const page = await viewer.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto(base + '/erp');
  await page.getByRole('button', { name: 'الخزينة', exact: true }).click();
  const ledger = page.locator('.treasury-ledger');
  await expect(ledger.locator('[data-sequence]')).toHaveCount(100);
  const atBottom = () => ledger.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 3);
  await expect.poll(atBottom).toBe(true);
  await expect(page.locator('[data-sequence="205"]')).toBeInViewport();
  const head = page.locator('.treasury-ledger-row.head');
  await expect(head).toBeInViewport();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => {
      localStorage.setItem('abdo-erp-theme', t);
      document.documentElement.dataset.theme = t;
    }, theme);
    for (const width of [1440, 1024, 901]) {
      await page.setViewportSize({ width, height: 950 });
      await page.waitForTimeout(450);
      await expect.poll(atBottom).toBe(true);
      const cards = await page.locator('.treasury-card').evaluateAll((es) =>
        es.map((e) => {
          const r = e.getBoundingClientRect();
          return { w: r.width, h: r.height, y: r.y };
        }),
      );
      assert.ok(
        cards.every((c) => Math.abs(c.w - cards[0].w) < 1 && c.h === cards[0].h && c.y === cards[0].y),
      );
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await expect(page.locator('.treasury-cards')).toBeInViewport();
      for (const [direction, button] of [['in', 'cash-in'], ['out', 'cash-out']]) {
        const row = page.locator(`.treasury-ledger-row.${direction}`).last();
        assert.equal(await row.evaluate(e => getComputedStyle(e).backgroundColor),
          await page.locator(`.${button}`).evaluate(e => getComputedStyle(e).backgroundColor));
        const cells = await row.locator(':scope > span').evaluateAll(es => es.map(e => ({
          width: e.getBoundingClientRect().width, border: getComputedStyle(e).borderLeftWidth,
        })));
        assert.equal(cells[0].width, 52);
        assert.ok(cells[1].width >= 180);
        assert.ok(cells.slice(0, -1).every(c => c.border === '1px'));
        await expect(row.locator('.treasury-date-desktop')).toBeVisible();
        await expect(row.locator('.treasury-date-phone')).toBeHidden();
      }
      await page.screenshot({ path: `artifacts/treasury/${theme}-${width}.png` });
    }
  }
  await page.setViewportSize({ width: 1440, height: 950 });
  await ledger.evaluate((e) => {
    e.scrollTop = 200;
  });
  await page.waitForTimeout(150);
  const oldTop = await ledger.evaluate((e) => e.scrollTop);
  await add();
  await expect(page.locator('.treasury-new-movements')).toBeVisible({ timeout: 10000 });
  assert.ok(
    Math.abs((await ledger.evaluate((e) => e.scrollTop)) - oldTop) < 2,
    'Realtime must preserve reading position',
  );
  await page.getByRole('button', { name: 'تحميل حركات أقدم' }).click();
  await expect(ledger.locator('[data-sequence]')).toHaveCount(201);
  assert.ok(
    (await ledger.evaluate((e) => e.scrollTop)) > oldTop + 1000,
    'Prepending preserves visible anchor',
  );
  await page.locator('.treasury-new-movements').click();
  await expect.poll(atBottom).toBe(true);
  await ledger.evaluate((e) => {
    e.scrollTop = 100;
  });
  await page.waitForTimeout(150);
  await page.getByRole('button', { name: 'دخول', exact: true }).click();
  await page.locator('input[name="amountUnits"]').fill('100');
  await page.locator('input[name="description"]').fill('إضافة من الواجهة');
  await page.locator('.treasury-entry-form .primary').click();
  await expect(page.locator('[data-sequence="207"]')).toHaveCount(1);
  await expect.poll(atBottom).toBe(true);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(450);
    await expect(page.locator('.treasury-head')).toBeVisible();
    assert.equal(await ledger.evaluate((e) => getComputedStyle(e).overflow), 'visible');
    await page.screenshot({ path: `artifacts/treasury/${theme}-phone.png` });
  }
  const reader = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await reader.request.post(base + '/api/auth/login', {
    headers: { 'X-Client-Api-Version': '1' },
    data: { username: 'reader', password: 'Reader Test 123!' },
  });
  const readerPage = await reader.newPage();
  await readerPage.goto(base + '/erp');
  await readerPage.getByRole('button', { name: 'الخزينة', exact: true }).click();
  await expect(readerPage.locator('.treasury-ledger [data-sequence]')).toHaveCount(100);
  await expect(readerPage.locator('.treasury-cash-actions')).toHaveCount(0);
  await expect(readerPage.locator('[data-sequence="207"]')).toBeInViewport();
  await readerPage.screenshot({ path: 'artifacts/treasury/employee.png' });
  assert.deepEqual(errors, []);
  console.log(
    'PASS: 207 real temporary ledger entries, chronological order, initial latest, sticky header, equal cards at 901/1024/1440, both themes, realtime anchor, older history, own submission, phone layout, employee permissions',
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
