import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { accountSearchFixture } from './helpers/accountSearchFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';

const { db, admin, ids, companyId, hiddenId } = accountSearchFixture();
const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
const assignments = db.prepare('SELECT * FROM debt_assignments ORDER BY id').all();
const server = createApp(db, loadConfig({ databasePath: ':memory:', secureCookie: false, internetRequired: false, publicOrigin: '' }));
const browser = await chromium.launch();
try {
  await listen(server, '127.0.0.1', 0);
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const session = createSession(db, admin.id, '1', 12);
  await context.addCookies([{ name: 'abdo_session', value: session.token, url: base }]);
  const page = await context.newPage();
  const errors: string[] = [], writes: string[] = [], ledgerReads: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/(customers|companies|collections)/.test(path) && request.method() !== 'GET') writes.push(path);
    if (/\/ledger$/.test(path)) ledgerReads.push(path);
  });
  await page.goto(base + '/erp');
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 20000 });
  const search = page.getByLabel('البحث الموحد', { exact: true });
  async function reveal(name: string, id: string, section: string, assigned: boolean) {
    ledgerReads.length = 0;
    await search.fill(name);
    await page.locator('.global-search-result').filter({hasText:name}).getByRole('button',{name:'عرض كارت '+name,exact:true}).click();
    const card = page.locator(`[data-customer-id="${id}"]`);
    await expect(page.locator('.workspace')).toHaveClass(new RegExp('active-section-' + section));
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-search-highlight', 'true');
    await expect(card).toBeInViewport();
    await expect(page.locator('.ledger-panel')).toHaveCount(0);
    if (assigned) await expect(card.locator('.customer-assignee-badge')).toContainText('fixture-collector');
    else await expect(card.locator('.customer-assignee-badge')).toHaveCount(0);
    assert.deepEqual(ledgerReads, [], 'Search does not open or fetch the ledger');
    return card;
  }
  mkdirSync('artifacts/account-search-card', { recursive: true });
  let card = await reveal('عميل بحث موجه', ids[0], 'customers', true);
  await page.screenshot({ path: 'artifacts/account-search-card/customer-desktop.png' });
  await card.locator('.customer-card-main').click();
  await expect(page.locator('.ledger-panel')).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق السجل', exact: true }).click();
  await reveal('شركة بحث موجهة', companyId, 'companies', true);
  await page.setViewportSize({ width: 390, height: 844 });
  await reveal('عميل بحث مخفي', hiddenId, 'customers', false);
  card = await reveal('شركة بحث موجهة', companyId, 'companies', true);
  await page.screenshot({ path: 'artifacts/account-search-card/company-phone.png' });
  await page.getByRole('tab', { name: 'مسدد', exact: true }).click();
  await expect(card).toHaveCount(0);
  await reveal('شركة بحث موجهة', companyId, 'companies', true);
  await reveal('شركة بحث موجهة', companyId, 'companies', true);
  async function openLedger(name:string,assigned:boolean,keyboard=false) {
    await search.fill(name);
    const result=page.locator('.global-search-result').filter({hasText:name});
    await expect(result.locator('.global-search-assignment')).toHaveText(assigned?'موجّه إلى: fixture-collector':'غير موجّه');
    ledgerReads.length=0;
    if(keyboard)await search.press('Enter');
    else await result.getByRole('button',{name:'فتح سجل '+name,exact:true}).click();
    await expect(page.locator('.ledger-panel')).toBeVisible();
    await expect(page.locator('.ledger-panel')).toContainText(name);
    assert.ok(ledgerReads.length>0,'Default result action reads the ledger immediately');
    await page.getByRole('button',{name:'إغلاق السجل',exact:true}).click();
  }
  await openLedger('شركة بحث موجهة',true);
  await openLedger('عميل بحث مخفي',false,true);
  await page.setViewportSize({width:1366,height:900});
  await openLedger('عميل بحث موجه',true);
  for(const theme of ['light','dark'])for(const shell of ['original','03'])for(const width of [1366,390]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(({theme,shell})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.royalShell=shell;},{theme,shell});
    await search.fill('بحث');
    await expect(page.locator('.global-search-result')).toHaveCount(3);
    await expect.poll(()=>page.locator('.global-search-results').evaluate(el=>el.clientWidth)).toBeGreaterThan(150);
    const geometry=await page.locator('.global-search-results').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,
      children:Array.from(el.querySelectorAll('button,span,small,b')).map(node=>({cls:node.className,width:node.getBoundingClientRect().width,scroll:node.scrollWidth,text:node.textContent?.slice(0,30)}))}));
    assert.ok(geometry.scroll<=geometry.width+1,`Search results fit ${theme}/${shell}/${width}: ${JSON.stringify(geometry)}`);
    const contrast=await page.locator('.global-search-show-card').first().evaluate(button=>{
      const light=(color:string)=>{const c=(color.match(/[\d.]+/g)??[]).slice(0,3).map(Number).map(v=>{const s=v/255;return s<=0.04045?s/12.92:((s+0.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
      const style=getComputedStyle(button),fg=light(style.color),bg=light(style.backgroundColor);
      return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
    });
    assert.ok(contrast>=4.5,`Readable card action in ${theme}/${shell}/${width}`);
    await page.screenshot({path:`artifacts/account-search-card/results-${theme}-${shell}-${width}.png`});
  }
  await search.press('ArrowDown');
  const selectedName=await page.locator('.global-search-result[data-selected="true"] strong').innerText();
  await search.press('Enter');
  await expect(page.locator('.ledger-panel')).toContainText(selectedName);
  await page.getByRole('button',{name:'إغلاق السجل',exact:true}).click();
  await search.fill('بحث');await expect(page.locator('.global-search-result')).toHaveCount(3);
  await search.press('Escape');await expect(page.locator('.global-search-results')).toHaveCount(0);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(), before);
  assert.deepEqual(db.prepare('SELECT * FROM debt_assignments ORDER BY id').all(), assignments);
  console.log('PASS dual search: assignment badges, direct ledger, secondary card reveal, Enter/arrows/Escape, cross-section, beyond page one, hidden zero, both themes/shells/phone; balances and assignments unchanged.');
} finally {
  await browser.close(); server.closeRealtimeConnections(); server.closeAllConnections();
  await new Promise<void>(done => server.close(() => done())); db.close();
}
