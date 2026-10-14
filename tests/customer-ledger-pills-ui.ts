import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser, type APIRequestContext } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';

const section = process.env.LEDGER_UI_SECTION === 'companies' ? 'companies' : 'customers';
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
  const created = await mutate('/api/'+section,{requestId:'ledger-pills-customer',name:'عميل تنسيق السجل',openingBalance:100});
  const page = await writer.newPage();
  await page.goto(base+'/erp');
  if (section === 'companies') await page.getByRole('button',{name:'قسم ديون الشركات',exact:true}).click();
  await page.locator('.customer-card-main').filter({hasText:'عميل تنسيق السجل'}).click();
  const panel = page.locator('.ledger-panel.section-'+section);
  const kind = panel.getByRole('group',{name:'نوع المعاملة',exact:true});
  const mode = panel.getByRole('group',{name:'طريقة الحساب',exact:true});
  await expect(kind.getByRole('button',{name:'ديون',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(mode.getByRole('button',{name:'مباشر',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(panel.locator('select')).toHaveCount(0);
  mkdirSync('artifacts/ledger-pills',{recursive:true});
  for (const theme of ['light','dark']) {
    await panel.locator('header .icon-button').click();
    if (await page.evaluate(()=>document.documentElement.dataset.theme)!==theme) await page.getByRole('button',{name:theme==='dark'?'المظهر الليلي':'المظهر النهاري',exact:true}).click();
    await page.locator('.customer-card-main').filter({hasText:'عميل تنسيق السجل'}).click();
    for (const width of [390,1440]) {
      await page.setViewportSize({width,height:950});
      await expect(panel).toHaveCSS('opacity','1');
      await expect(kind.getByRole('button',{name:'ديون',exact:true})).toHaveCSS('background-color','rgb(166, 30, 42)');
      await expect(kind.getByRole('button',{name:'دفع جزئي',exact:true})).toHaveCSS('background-color','rgb(8, 116, 67)');
      await expect(kind.getByRole('button',{name:'دفع كلي',exact:true})).toHaveCSS('background-color','rgb(23, 25, 31)');
      for (const group of [kind,mode]) {
        const boxes=await group.locator('button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {y:r.y,height:r.height,overflow:e.scrollWidth>e.clientWidth+1}}));
        assert.equal(new Set(boxes.map(b=>b.y)).size,1);
        assert.ok(boxes.every(b=>b.height>=32&&!b.overflow));
      }
      await kind.scrollIntoViewIfNeeded();
      await page.screenshot({path:`artifacts/ledger-pills/${section}-${theme}-${width}-choices.png`,fullPage:true});
      await panel.locator('.ledger-total').scrollIntoViewIfNeeded();
      await page.screenshot({path:`artifacts/ledger-pills/${section}-${theme}-${width}-total.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:950});
  await mode.getByRole('button',{name:'قسمة',exact:true}).click();
  await panel.getByLabel('قيمة المعاملة',{exact:true}).fill('150');
  await panel.getByLabel('السعر',{exact:true}).fill('5');
  await panel.getByLabel('ملاحظة المعاملة').fill('قسمة اختبار');
  await panel.getByRole('button',{name:'اعتماد المعاملة',exact:true}).click();
  await expect(panel.locator('.ledger-record').filter({hasText:'قسمة اختبار'})).toBeVisible();
  assert.equal((await read(writer.request,'/api/'+section+'/'+created.customer.id)).balanceUnits,130);
  await kind.getByRole('button',{name:'دفع جزئي',exact:true}).click();
  await panel.getByLabel('قيمة المعاملة',{exact:true}).fill('10');
  await panel.getByLabel('ملاحظة المعاملة').fill('جزئي اختبار');
  await panel.getByRole('button',{name:'اعتماد المعاملة',exact:true}).click();
  await expect(panel.locator('.ledger-record').filter({hasText:'جزئي اختبار'})).toBeVisible();
  await panel.locator('.ledger-record').filter({hasText:'قسمة اختبار'}).getByRole('button',{name:/تعديل المعاملة/}).click();
  const editing=panel.locator('.ledger-draft-row').first();
  await expect(editing.getByRole('button',{name:'قسمة',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(editing.getByLabel('السعر')).toHaveValue('5');
  await editing.getByRole('button',{name:'إلغاء المسودة',exact:true}).click();
  await kind.getByRole('button',{name:'دفع كلي',exact:true}).click();
  await expect(mode.getByRole('button',{name:'مباشر',exact:true})).toBeDisabled();
  await expect(panel.getByLabel('السعر')).toBeDisabled();
  await panel.getByRole('button',{name:'اعتماد المعاملة',exact:true}).click();
  await expect.poll(async()=>(await read(writer.request,'/api/'+section+'/'+created.customer.id)).balanceUnits).toBe(0);
  console.log('PASS customer ledger pills: both themes/sizes, selection, divide, partial/full, editing retains mode and factor.');
} finally {
  await browser?.close();
  server.closeRealtimeConnections();
  await new Promise<void>(done=>server.close(()=>done()));
  database.close();
  rmSync(directory,{recursive:true,force:true});
}
