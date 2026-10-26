import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import type { AddressInfo } from 'node:net';

const { db, admin } = accountCardFixture();
const server = createApp(
  db,
  loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }),
);
await listen(server, '127.0.0.1', 0);
const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
  output = 'artifacts/emerald-shell';
const before = db
  .prepare('SELECT id,current_balance_units,ledger_next_sequence FROM customers ORDER BY id')
  .all();
mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [],
  writes: string[] = [];
try {
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([
    { name: 'abdo_session', value: session.token, url: base, httpOnly: true, sameSite: 'Strict' },
  ]);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (!['GET', 'HEAD'].includes(r.method()) && !r.url().includes('/api/auth/')) writes.push(r.url());
  });
  await page.goto(base + '/erp');
  const toggle = page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  async function appearance(label: string) {
    if (((await toggle.getAttribute('aria-pressed')) === 'true') === (label !== 'الشكل الأصلي')) return;
    const mobile = (page.viewportSize()?.width ?? 1440) <= 900;
    if (mobile) await page.getByRole('button', { name: 'فتح القائمة الرئيسية', exact: true }).click();
    await toggle.click();
    if (mobile) await page.locator('.sidebar-mobile-close').click();
  }
  async function cardState() {
    return page.locator('.customer-card').evaluateAll((nodes) =>
      nodes.map((el) => {
        const style = getComputedStyle(el),
          rect = el.getBoundingClientRect();
        return {
          text: el.textContent,
          background: style.backgroundImage,
          border: style.borderColor,
          width: rect.width,
          height: rect.height,
          content: [...el.querySelectorAll('.customer-card-main,.customer-card-main *')].map((child) => {
            const s = getComputedStyle(child);
            return { text: child.textContent, color: s.color, font: s.fontSize };
          }),
        };
      }),
    );
  }
  const sections = [
    ['customers', 'قسم ديون العملاء', 'عميل محمد علي 01'],
    ['companies', 'قسم ديون الشركات', 'شركة محمد علي 01'],
    ['libyan', 'أمانات ليبية', 'أمانة ليبية محمد علي 01'],
    ['egyptian', 'أمانات مصرية', 'حساب مصري محمد علي 01'],
  ];
  for (const [section, title, sample] of sections) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('.customer-name-line').getByText(sample, { exact: true })).toBeVisible();
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, mode);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate(async () => {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await Promise.all(
            document
              .getAnimations()
              .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
              .map((animation) => animation.finished.catch(() => {})),
          );
        });
        await appearance('الشكل الأصلي');
        const baseline = await cardState(),
          notification = await page.getByRole('button', { name: 'الإشعارات', exact: true }).boundingBox();
        const search = await page.getByRole('textbox', { name: 'البحث الموحد', exact: true }).boundingBox();
        await appearance('03 · الزمردي الملكي اللامع');
        const actual = await cardState();
        assert.equal(actual.length, baseline.length);
        actual.forEach((card, index) => {
          assert.ok(
            Math.abs(card.width - baseline[index].width) < 0.5 &&
              Math.abs(card.height - baseline[index].height) < 0.5,
            `${section}/${mode}/${width} card ${index}: ${baseline[index].width}x${baseline[index].height} -> ${card.width}x${card.height}`,
          );
          assert.deepEqual(
            { ...card, width: 0, height: 0 },
            { ...baseline[index], width: 0, height: 0 },
            'Card data, typography or colors changed',
          );
        });
        assert.deepEqual(
          await page.getByRole('button', { name: 'الإشعارات', exact: true }).boundingBox(),
          notification,
          'Notification moved',
        );
        assert.deepEqual(
          await page.getByRole('textbox', { name: 'البحث الموحد', exact: true }).boundingBox(),
          search,
          'Search moved',
        );
        const shell = await page
          .locator('.dashboard-utility-bar')
          .evaluate((el) => getComputedStyle(el).backgroundImage);
        assert.ok(shell.includes(mode === 'dark' ? '43, 136, 99' : '70, 181, 138'), shell);
        assert.ok(
          await page
            .locator('.sidebar nav button.active')
            .evaluate((el) => getComputedStyle(el).backgroundImage.includes('gradient')),
        );
        await page.screenshot({ path: `${output}/${section}-${mode}-${width}.png` });
      }
    }
    console.log(
      `PASS ${section}: glossy light/dark, desktop/mobile; all card text/colors/amounts/dimensions, search and notifications unchanged.`,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const others = [
    ['collections', 'قسم استلامات الديون'],
    ['masraweya', 'صفحة المصراوية'],
    ['purchases', 'قسم المشتريات'],
    ['treasury', 'الخزينة'],
    ['reports', 'التقارير الذكية'],
    ['settings', 'الإعدادات'],
  ];
  const ready: Record<string, string> = {
    collections: '.collection-overview-header',
    masraweya: '.masraweya-header',
    purchases: '.purchase-action-dock',
    treasury: '.treasury-panel-head',
    reports: '.financial-overview-head',
    settings: '.settings-topbar',
  };
  for (const [name, title] of others) {
    await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('.sidebar nav button.active')).toHaveText(title);
    await expect(page.locator(ready[name]).first()).toBeVisible();
    for (const mode of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, mode);
      await appearance('03 · الزمردي الملكي اللامع');
      const shell = await page
        .locator('.dashboard-utility-bar')
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      assert.ok(shell.includes(mode === 'dark' ? '43, 136, 99' : '70, 181, 138'));
      await page.screenshot({ path: `${output}/${name}-${mode}.png` });
    }
    console.log(`PASS ${title}: consistent shell in both modes.`);
  }
  await page.locator('.sidebar').getByRole('button', { name: 'قسم ديون العملاء', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'البحث الموحد', exact: true });
  await search.fill('محمد');
  await expect(page.locator('.global-search-results button').first()).toBeVisible();
  await search.fill('');
  const bell = page.getByRole('button', { name: 'الإشعارات', exact: true });
  await bell.click();
  await expect(page.locator('.notification-panel')).toBeVisible();
  await bell.click();
  const readability = page.locator('.readability-control');
  await readability.click();
  await expect(readability).toHaveAttribute('data-level', 'large');
  await readability.click();
  await readability.click();
  await appearance('الشكل الأصلي');
  assert.equal(await page.locator('html').getAttribute('data-royal-shell'), null);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  assert.equal(await page.locator('html').getAttribute('data-royal-shell'), null);
  await appearance('03');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  assert.deepEqual(
    db.prepare('SELECT id,current_balance_units,ledger_next_sequence FROM customers ORDER BY id').all(),
    before,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log(
    'PASS original switch, search results, notification button, readability control; no financial writes or JavaScript errors.',
  );
} finally {
  await context.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
}
