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
import { MAIN_SECTIONS, SECTION_CONTRACTS } from '../src/shared/sections.ts';
const folder = mkdtempSync(join(tmpdir(), 'erp-auth-l01-'));
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
  const page = await browser.newPage({ viewport: { width: 1672, height: 941 }, bypassCSP: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const setup = await page.request.post(base + '/api/setup/admin', {
    data: { username: 'admin', displayName: 'اختبار البوابة', password: 'Auth Preview 123!' },
  });
  assert.ok(setup.ok());
  const actor = fixtureAdmin(database);
  createCustomer(
    database,
    actor,
    { name: 'عميل بحث تجريبي', openingBalance: 1000, requestId: 'search-focus-client' },
    'test',
  );
  await page.goto(base + '/erp');
  await page.getByLabel('البريد الإلكتروني', { exact: true }).fill('admin');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('Auth Preview 123!');
  await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  assert.deepEqual(errors, []);

  const output = resolve('artifacts/search-focus');
  mkdirSync(output, { recursive: true });
  const search = page.getByLabel('البحث الموحد', { exact: true });
  for (const shell of ['03', 'original']) {
    await page.evaluate((value) => {
      if (value === 'original') delete document.documentElement.dataset.royalShell;
      else document.documentElement.dataset.royalShell = value;
    }, shell);
    for (const width of [1440, 1100, 390]) {
      await page.setViewportSize({ width, height: 950 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        for (const section of MAIN_SECTIONS) {
          if (width <= 900)
            await page.getByRole('button', { name: 'فتح القائمة الرئيسية', exact: true }).click();
          await page
            .locator('.sidebar')
            .getByRole('button', { name: SECTION_CONTRACTS[section].title, exact: true })
            .click();
          await page.locator('.workspace.active-section-' + section).waitFor();
          const bell = page.getByRole('button', { name: 'الإشعارات', exact: true });
          const reading = page.getByRole('button', { name: /تكبير القراءة/ });
          const before = { bell: await bell.boundingBox(), reading: await reading.boundingBox() };
          await search.click();
          const frame = await search.evaluate((input) => {
            const shell = input.parentElement!;
            const i = input.getBoundingClientRect();
            const b = shell.getBoundingClientRect();
            const css = getComputedStyle(input);
            const outer = getComputedStyle(shell);
            return {
              input: { left: i.left, right: i.right, top: i.top, bottom: i.bottom },
              shell: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
              outline: css.outlineStyle,
              shadow: css.boxShadow,
              outerWidth: parseFloat(outer.outlineWidth),
              outerOffset: parseFloat(outer.outlineOffset),
            };
          });
          const label = shell + '/' + section + '/' + width + '/' + theme;
          assert.equal(frame.outline, 'none', label + ': duplicate inner outline');
          assert.equal(frame.shadow, 'none', label + ': inner focus shadow');
          assert.equal(frame.outerWidth, 2, label + ': shell focus missing');
          assert.equal(frame.outerOffset, -2, label + ': shell outline must align inward');
          assert.ok(
            frame.input.top >= frame.shell.top - 1 && frame.input.bottom <= frame.shell.bottom + 1,
            label + ': input extends beyond shell',
          );
          assert.ok(
            frame.input.left >= frame.shell.left - 1 && frame.input.right <= frame.shell.right + 1,
            label + ': input extends horizontally',
          );
          assert.deepEqual(await bell.boundingBox(), before.bell, label + ': notifications moved on focus');
          assert.deepEqual(
            await reading.boundingBox(),
            before.reading,
            label + ': reading button moved on focus',
          );
          await page.keyboard.press('Shift+Tab');
          await page.keyboard.press('Tab');
          assert.ok(
            await search.evaluate((input) => document.activeElement === input),
            label + ': keyboard focus failed',
          );
          assert.equal(await search.evaluate((input) => getComputedStyle(input).outlineStyle), 'none');
          await search.fill('عميل بحث');
          await page
            .locator('.global-search-results > button')
            .filter({ hasText: 'عميل بحث تجريبي' })
            .waitFor();
          const result = page.locator('.global-search-results > button').first();
          for (const state of ['normal', 'hover', 'focus']) {
            if (state === 'hover') await result.hover();
            if (state === 'focus') {
              await search.hover();
              await result.focus();
            }
            const colors = await result.evaluate((button) => {
              const rgb = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
              const luminance = (color: number[]) =>
                color.slice(0, 3).reduce((sum, value, index) => {
                  const s = value / 255;
                  return (
                    sum +
                    (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) *
                      [0.2126, 0.7152, 0.0722][index]
                  );
                }, 0);
              const background = rgb(getComputedStyle(button).backgroundColor);
              const back = luminance(background);
              return {
                background,
                panel: rgb(getComputedStyle(button.parentElement!).backgroundColor),
                contrast: [...button.querySelectorAll('strong,small,b')].map((node) => {
                  const front = luminance(rgb(getComputedStyle(node).color));
                  return (Math.max(front, back) + 0.05) / (Math.min(front, back) + 0.05);
                }),
              };
            });
            if (shell === '03') {
              assert.ok(
                colors.background.length === 3 || colors.background[3] === 1,
                label + '/' + state + ': transparent result',
              );
              assert.ok(
                colors.panel.length === 3 || colors.panel[3] === 1,
                label + '/' + state + ': transparent panel',
              );
              assert.ok(
                colors.contrast.every((ratio) => ratio >= 4.5),
                label + '/' + state + ': low search contrast ' + JSON.stringify(colors),
              );
            }
          }
          if (shell === '03' && theme === 'light' && (section === 'customers' || section === 'companies'))
            await page.screenshot({
              path: join(output, 'emerald-results-' + section + '-' + width + '.png'),
            });
          await page.getByRole('button', { name: 'مسح البحث', exact: true }).click();
          assert.equal(await search.inputValue(), '');
          await page.locator('.global-search-results').waitFor({ state: 'detached' });
          const level = await reading.getAttribute('data-level');
          await reading.click();
          assert.notEqual(await reading.getAttribute('data-level'), level);
          assert.equal(
            await page
              .locator('.global-account-search')
              .evaluate((shell) => getComputedStyle(shell).outlineStyle),
            'none',
            label + ': search frame persisted on reading button',
          );
          await bell.click();
          await page.locator('.notification-panel').waitFor({ state: 'visible' });
          await bell.click();
          await search.click();
          if ((section === 'customers' || section === 'companies') && theme === 'light')
            await page.screenshot({ path: join(output, section + '-' + width + '.png') });
        }
      }
    }
  }
  // Opening an actual suggestion must still navigate to its ledger correctly.
  await search.fill('عميل بحث');
  await page.locator('.global-search-results > button').filter({ hasText: 'عميل بحث تجريبي' }).click();
  await page.locator('.ledger-panel').waitFor();
  await page.getByRole('heading', { name: 'عميل بحث تجريبي', exact: true }).waitFor();
  assert.equal(
    database.prepare("SELECT current_balance_units FROM customers WHERE name='عميل بحث تجريبي'").get()!
      .current_balance_units,
    1000,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS search focus: aligned frame, unchanged adjacent positions, opaque emerald results with readable contrast, search/clear, magnification and notifications across 10 sections, 3 widths, 2 themes and both shells; suggestion opens ledger without financial changes.',
  );
} finally {
  await browser.close();
  await new Promise<void>((r) => server.close(() => r()));
  database.close();
  rmSync(folder, { recursive: true, force: true });
}
