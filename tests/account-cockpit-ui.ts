import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin } = accountCardFixture(36);
db.prepare('UPDATE customers SET zero_review_pending=1 WHERE current_balance_units=0').run();
const pendingIds = new Set((db.prepare('SELECT id FROM customers WHERE current_balance_units=0 AND zero_review_pending=1 AND system_link_key IS NULL').all() as { id: string }[]).map(item => item.id));
const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', publicOrigin: '', internetRequired: false, secureCookie: false }));
const browser = await chromium.launch();
const output = 'artifacts/account-cockpit';
mkdirSync(output, { recursive: true });
try {
  await listen(server, '127.0.0.1', 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'abdo_session', value: createSession(db, admin.id, '1', 12).token, url: base }]);
  const page = await context.newPage(), errors: string[] = [], writes: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
  await page.goto(base + '/erp');
  const toggle = page.getByRole('button', { name: 'تبديل تنسيق الأشرطة', exact: true });
  async function appearance(value: string) {
    for (let n = 0; n < 3 && await toggle.getAttribute('data-appearance') !== value; n++) await toggle.click();
    await expect(toggle).toHaveAttribute('data-appearance', value);
    if (value !== 'original') await expect(page.locator('html')).toHaveAttribute('data-royal-shell', value);
  }
  const cards = () => page.locator('.customer-card').evaluateAll(nodes => nodes.map(el => ({
    id: el.getAttribute('data-customer-id'), text: el.textContent,
    background: getComputedStyle(el).backgroundImage,
    amount: [...el.querySelectorAll('.customer-card-main *')].map(child => ({ text: child.textContent, color: getComputedStyle(child).color, font: getComputedStyle(child).fontFamily })),
  })));
  for (const [section, title] of [['customers', 'قسم ديون العملاء'], ['companies', 'قسم ديون الشركات'], ['libyan', 'أمانات ليبية'], ['egyptian', 'أمانات مصرية']]) {
    await page.setViewportSize({ width: 1600, height: 1050 });
    await page.locator('.sidebar nav').getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('.customer-card').first()).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await appearance('original');
    const baseline = await cards(), total = await page.locator('.debt-total-card').textContent();
    await appearance('03');
    assert.deepEqual(await cards(), baseline);
    await appearance('cockpit');
    const activeBaseline = await cards();
    if (section === 'customers') {
      // Ceramic is an intentional customer-only visual change. Retain exact
      // identity, wording, numeric strings and font checks across appearances.
      const content = (items: typeof baseline) => items.map(item => ({
        id: item.id, text: item.text, amount: item.amount.map(({ text, font }) => ({ text, font })),
      }));
      assert.deepEqual(content(activeBaseline), content(baseline));
      for (const [owner, color] of [['system', 'rgb(167, 37, 53)'], ['customer', 'rgb(18, 98, 71)'], ['zero', 'rgb(39, 45, 43)']]) {
        await expect(page.locator(`.customer-card[data-balance-owner='${owner}']`).first().locator('.customer-balance-amount')).toHaveCSS('color', color);
      }
    } else assert.deepEqual(activeBaseline, baseline, 'Other sections retain their original cards');
    await expect(page.locator('.customer-card')).toHaveCount(activeBaseline.length);
    await expect(page.locator('.debt-ticker')).toBeHidden();
    await expect(page.locator('.cockpit-account-filters [role="tab"]')).toHaveCount(2);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      for (const width of [2000, 1600, 1280, 1024, 800, 390]) {
        await page.setViewportSize({ width, height: 1050 });
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(async () => {
          const tools = await page.locator('.debts-toolbar').boundingBox(), grid = await page.locator('.customer-card-grid').boundingBox();
          return Boolean(tools && grid && grid.y >= tools.y + tools.height - 2 && tools.width >= width - (width > 900 ? 120 : 40));
        }).toBe(true);
        assert.equal(await page.locator('.debt-total-card').textContent(), total);
        const totalBox = await page.locator('.debt-total-card').boundingBox(), numberBox = await page.locator('.debt-total-card>strong').boundingBox();
        assert.ok(totalBox && numberBox && numberBox.y >= totalBox.y && numberBox.y + numberBox.height <= totalBox.y + totalBox.height + 1, `Net total fits its own panel: ${section}/${theme}/${width} ${JSON.stringify({totalBox,numberBox})}`);
        const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 2 || r.left < -2) && getComputedStyle(el).position !== 'fixed'; }).slice(0, 10).map(el => ({ class: el.className, width: el.getBoundingClientRect().width })));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `${section}/${theme}/${width}: page overflow ${JSON.stringify(overflow)}`);
        const toolbar = await page.locator('.debts-toolbar').boundingBox(), content = await page.locator('.customer-card-grid').boundingBox();
        assert.ok(toolbar && content);
        assert.ok(content.y >= toolbar.y + toolbar.height - 2, `Tools above cards: ${section}/${theme} ${JSON.stringify({toolbar,content})}`);
        await expect(page.locator('.dashboard-section-title')).toBeVisible();
        await expect(page.locator('.readability-control')).toHaveCount(1);
        if (width > 900) {
          const rail = await page.locator('.sidebar').boundingBox();
          assert.ok(rail && rail.width === 68, 'Single narrow navigation rail');
          const upper = await page.locator('.dashboard-section-title,.global-account-search,.readability-control,.sync-status,.notification-center').evaluateAll(nodes => nodes.map(el => ({ class: el.className, x: el.getBoundingClientRect().x })));
          const x = (selector: string) => upper.find(item => item.class.includes(selector))!.x;
          assert.ok(x('dashboard-section-title') > x('global-account-search') && x('global-account-search') > x('readability-control') && x('readability-control') > x('sync-status') && x('sync-status') > x('notification-center'), 'Requested first-row RTL order');
        }
        if (width > 1200) {
          const selectors = ['.debt-total-card', '.cockpit-account-filters button:first-child', '.cockpit-account-filters button:last-child', '.add-customer-card', ...(section === 'customers' || section === 'companies' ? ['.routing-card'] : []), '.dashboard-search'];
          const positions = await Promise.all(selectors.map(selector => page.locator(selector).boundingBox()));
          positions.forEach((box, index) => { assert.ok(box); if (index) assert.ok(positions[index - 1]!.x > box.x, 'Requested second-row RTL order'); });
        }
        const controls = await page.locator('.cockpit-account-filters button,.add-customer-card,.routing-card').evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
        assert.ok(controls.every(control => Math.abs(control.width - controls[0].width) < 1 && Math.abs(control.height - controls[0].height) < 1), `${section}/${theme}/${width}: matching control sizes`);
        const searchBox = await page.locator('.dashboard-search').boundingBox(), totalCardBox = await page.locator('.debt-total-card').boundingBox();
        assert.ok(searchBox && totalCardBox && Math.abs(searchBox.height - totalCardBox.height) < 1, 'Search and net total use matching frame heights');
        await expect(page.locator('.add-customer-card')).toBeVisible();
        if (section === 'egyptian') {
          const rate = page.getByRole('spinbutton', { name: 'سعر الجنيه المصري لكل دينار ليبي', exact: true });
          await expect(rate).toBeVisible();
          const rateBox = await rate.boundingBox(), rateCard = await page.locator('.exchange-rate-card').boundingBox();
          assert.ok(rateBox && rateCard && rateBox.width >= 60 && rateBox.height >= 30);
          assert.ok(rateBox.y + rateBox.height <= rateCard.y + rateCard.height + 2, 'Rate stays inside its panel');
        }
        await page.screenshot({ path: `${output}/${section}-${theme}-${width}.png` });
      }
    }
    await page.setViewportSize({ width: 1600, height: 1050 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await page.locator('.sidebar-hide-button').click();
    await expect(page.locator('.dashboard-section-title')).toBeVisible();
    await expect(page.locator('.dashboard-section-title')).toBeVisible();
    await expect.poll(async () => {
      const title = await page.locator('.dashboard-section-title').boundingBox(), reveal = await page.locator('.sidebar-reveal').boundingBox();
      return Boolean(title && reveal && title.x + title.width <= reveal.x + 2);
    }).toBe(true);
    await page.screenshot({ path: `${output}/${section}-sidebar-hidden.png` });
    await page.locator('.sidebar-reveal').click();
    await page.locator('.add-customer-card').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    if (section === 'customers' || section === 'companies') {
      await page.locator('.routing-card').click();
      await expect(page.locator('.routing-bar')).toBeVisible();
      await page.locator('.routing-card').click();
      await expect(page.locator('.routing-bar')).toBeHidden();
    }
    assert.deepEqual(await cards(), activeBaseline, 'Active card data, colors, wording and typography preserved');
    const local = page.locator('.dashboard-search input');
    await local.fill('محمد علي 01');
    await expect(page.locator('.customer-card')).toHaveCount(1);
    await local.fill('');
    await expect.poll(() => page.locator('.customer-card').count()).toBe(activeBaseline.length);
    await page.locator('.cockpit-account-filters').getByRole('tab', { name: /صفر ينتظر المراجعة/ }).click();
    await expect(page.locator('.customer-card')).toHaveCount(baseline.filter(card => pendingIds.has(card.id!)).length);
    await expect(page.locator('.customer-card .customer-balance-amount').first()).toHaveText('0');
    assert.equal(await page.locator('.debt-total-card').textContent(), total);
    const reviewing = page.locator('.customer-card').filter({ has: page.locator('.zero-review-status.pending') }).first();
    const reviewedId = await reviewing.getAttribute('data-customer-id');
    await reviewing.locator('.zero-review-status.pending').click();
    await expect(page.locator('.customer-card')).toHaveCount(baseline.filter(card => pendingIds.has(card.id!)).length - 1);
    await expect(page.locator('.alert.success')).not.toContainText('المسدد');
    await page.locator('.cockpit-account-filters').getByRole('tab', { name: /الكروت النشطة/ }).click();
    await expect(page.locator('.customer-card')).toHaveCount(activeBaseline.length);
    await expect(page.locator(`[data-customer-id="${reviewedId}"] .zero-review-status.reviewed`)).toBeVisible();
    const order = await page.locator('.customer-card').evaluateAll(nodes => nodes.map(el => ({ id: el.getAttribute('data-customer-id'), zero: el.getAttribute('data-balance-owner') === 'zero' })));
    assert.ok(order.findIndex(card => card.id === reviewedId) > Math.max(...order.flatMap((card, index) => card.zero ? [] : [index])), 'Reviewed zero stays below non-zero cards');
    await appearance('original');
    await expect(page.locator('.cockpit-section-heading')).toBeHidden();
    assert.equal(await page.locator('.debts-toolbar').evaluate(el => getComputedStyle(el).position), 'static');
    await appearance('03');
    await expect(page.locator('.cockpit-section-heading')).toBeHidden();
  }
  await appearance('cockpit');
  await page.reload();
  await expect(toggle).toHaveAttribute('data-appearance', 'cockpit');
  const search = page.getByRole('textbox', { name: 'البحث الموحد', exact: true });
  await search.fill('محمد علي');
  await expect(page.locator('.global-search-results button').first()).toBeVisible();
  await search.fill('');
  const bell = page.getByRole('button', { name: 'الإشعارات', exact: true });
  await bell.click(); await expect(page.locator('.notification-panel')).toBeVisible(); await bell.click();
  await page.locator('.readability-control').click();
  await expect(page.locator('.readability-control')).toHaveAttribute('data-level', 'large');
  await page.locator('.readability-control').click();
  await expect(page.locator('.readability-control')).toHaveAttribute('data-level', 'off');
  await page.locator('.readability-control').click();
  await expect(page.locator('.readability-control')).toHaveAttribute('data-level', 'medium');
  assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(), before);
  assert.deepEqual(errors, []); assert.equal(writes.length, 4); assert.ok(writes.every(url => url.endsWith('/zero-review')));
  console.log('PASS: 4 sections × 2 themes × 6 widths; hidden sidebar title, responsive totals, all cards retained after zero review, nonzero active count, three appearances, search/tools and unchanged balances. Only 4 isolated review confirmations.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
}
