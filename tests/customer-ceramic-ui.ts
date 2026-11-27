import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { assignCustomers } from '../src/server/domain/collections.ts';

// Isolated presentation regression: never connect to installed company data.
const { db, admin, accounts } = accountCardFixture(24);
db.prepare('UPDATE users SET display_name=? WHERE id=?').run('أحمد محمد عبد الرحمن — موظف التحصيل التجريبي', admin.id);
db.prepare('UPDATE customers SET name=? WHERE id=?').run('شركة محمد عبد الرحمن وشركاه للتجارة والاستيراد والتوزيع', accounts.find(account => account.section === 'customers' && account.balance > 0)!.id);
db.prepare("INSERT OR REPLACE INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,'collections.write',1,?)").run(admin.id, new Date().toISOString());
assignCustomers(db, admin, { customerIds: [accounts.find(account => account.section === 'customers' && account.balance > 0)!.id], assigneeUserId: admin.id }, 'ceramic-preview');
db.prepare('UPDATE customers SET zero_review_pending=1 WHERE current_balance_units=0').run();
const balances = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const browser = await chromium.launch();
const output = 'artifacts/customer-ceramic';
mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'abdo_session', value: createSession(db, admin.id, '1', 12).token, url: base }]);
  await context.addInitScript(() => localStorage.setItem('abdo-shell-appearance', 'cockpit'));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/erp');
  await page.locator('.sidebar nav').getByRole('button', { name: 'قسم ديون العملاء', exact: true }).click();
  await expect(page.locator('.customer-card').first()).toBeVisible();
  const count = await page.locator('.customer-card').count();
  const totals = await page.locator('.debt-total-card').textContent();
  const pin = page.locator('.pin-customer').first();
  async function assertNoOverlap(context: string) {
    // Theme/viewport changes must finish painting before measuring CSS geometry.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(() => page.locator('.customer-card').evaluateAll(cards => cards.flatMap(card => {
      const elements = [...card.querySelectorAll('.customer-balance-state,.customer-card-label,.customer-name-line,.customer-card-main>b,.customer-last-movement,.zero-review-status,.customer-assignee-badge,.routing-select>span')]
        .map(el => ({ name: el.className || el.tagName, box: el.getBoundingClientRect() }))
        .filter(item => item.box.width > 0 && item.box.height > 0);
      const problems: string[] = [];
      for (let i = 0; i < elements.length; i++) for (let j = i + 1; j < elements.length; j++) {
        const a = elements[i], b = elements[j];
        if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > 1 && Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > 1) problems.push(`${card.getAttribute('data-customer-id')}: ${a.name} / ${b.name}; ${JSON.stringify({a:a.box,b:b.box,padding:getComputedStyle(card.querySelector('.customer-card-main')!).paddingTop,status:!!card.querySelector('.customer-card-status-row')})}`);
      }
      return problems;
    })), { message: `No overlapping card content: ${context}`, timeout: 5000 }).toEqual([]);
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const width of [2000, 1600, 1280, 1024, 800, 768, 430, 390, 360, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      await expect(pin).toBeHidden();
      await expect(page.locator('.customer-card')).toHaveCount(count);
      assert.equal(await page.locator('.debt-total-card').textContent(), totals);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `Page fits ${theme}/${width}`);
      for (const [owner, color, label, stateColor] of [['system', 'rgb(167, 37, 53)', 'دين', 'rgb(177, 38, 59)'], ['customer', 'rgb(18, 98, 71)', 'أمانة', 'rgb(19, 114, 79)'], ['zero', 'rgb(39, 45, 43)', 'صفر', 'rgb(53, 59, 64)']]) {
        const card = page.locator(`.customer-card[data-balance-owner='${owner}']`).first();
        await expect(card.locator('.customer-balance-amount')).toHaveCSS('color', color);
        assert.ok((await card.evaluate(el => getComputedStyle(el).backgroundImage)).includes('linear-gradient'));
        const state = card.locator('.customer-balance-state');
        if (theme === 'dark') {
          await expect(state).toBeVisible();
          await expect(state).toHaveText(label);
          await expect(state).toHaveCSS('color', 'rgb(255, 255, 255)');
          await expect(state).toHaveCSS('background-color', stateColor);
          assert.equal(await card.evaluate(el => getComputedStyle(el, '::after').backgroundColor), stateColor);
        } else await expect(state).toBeHidden();
      }
      const review = page.locator('.zero-review-status.pending').first();
      const rect = await review.boundingBox();
      assert.ok(rect && rect.width >= (width <= 900 ? 44 : 38) && rect.height >= (width <= 900 ? 44 : 38));
      await expect(review.locator('svg')).toHaveCSS('width', '25px');
      const assigned = page.locator('.customer-card.has-assignee').first();
      const badgeBox = await assigned.locator('.customer-assignee-badge').boundingBox();
      const nameBox = await assigned.locator('.customer-name-line').boundingBox();
      const cardBox = await assigned.boundingBox();
      assert.ok(badgeBox && nameBox && cardBox && badgeBox.y + badgeBox.height <= nameBox.y && cardBox.height <= 150, `Assignment fits compact card: ${theme}/${width} ${JSON.stringify({badgeBox,nameBox,cardBox})}`);
      if (theme === 'dark') {
        const stateBox = await assigned.locator('.customer-balance-state').boundingBox();
        assert.ok(stateBox && badgeBox && badgeBox.x + badgeBox.width <= stateBox.x, `Assignment and state do not overlap: ${width}`);
      }
      await assertNoOverlap(`${theme}/${width}`);
      await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const card = page.locator('.customer-card[data-balance-owner="zero"]').first();
  const id = await card.getAttribute('data-customer-id');
  await card.locator('.zero-review-status.pending').click();
  await expect(page.locator(`[data-customer-id="${id}"] .zero-review-status.reviewed`)).toBeVisible();
  await expect(page.locator('.ledger-panel')).toBeHidden();
  await expect(page.locator('.customer-card')).toHaveCount(count);
  await page.locator('.routing-card').click();
  for (const theme of ['light', 'dark']) for (const width of [1600, 390, 320]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.setViewportSize({ width, height: 1000 });
    await assertNoOverlap(`routing/${theme}/${width}`);
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const routed = page.locator('.customer-card[data-balance-owner="system"]').first();
  await routed.locator('.routing-select').click();
  await expect(routed).toHaveClass(/selected-routing/);
  await page.locator('.routing-card').click();
  await expect(page.locator('.routing-bar')).toBeHidden();
  const appearance = page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true });
  for (const expected of ['original', '03', 'cockpit']) {
    await appearance.click();
    await expect(appearance).toHaveAttribute('data-appearance', expected);
    if (expected !== 'cockpit') {
      await expect(pin).toBeVisible();
      await expect(page.locator('.customer-balance-state').first()).toBeHidden();
      assert.equal(await page.locator('.customer-card').first().evaluate(el => getComputedStyle(el).getPropertyValue('--ceramic-paper')), '');
    }
  }
  for (const name of ['قسم ديون الشركات', 'أمانات ليبية', 'أمانات مصرية']) {
    await page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('.customer-card').first()).toBeVisible();
    await expect(page.locator('.pin-customer').first()).toBeVisible();
    assert.equal(await page.locator('.customer-card').first().evaluate(el => getComputedStyle(el).getPropertyValue('--ceramic-paper')), '');
  }
  assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(), balances);
  assert.deepEqual(errors, []);
  console.log('PASS: ceramic customer cards only; 2 themes × 10 widths; no overlapping labels, names, amounts, timestamps, review or assignment with long customer/employee names; ownership colors, review action, unchanged balances/totals and other appearances/sections.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
