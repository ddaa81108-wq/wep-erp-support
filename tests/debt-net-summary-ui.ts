import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
  let csrf = (await login.json()).data.csrfToken as string;
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

  for (const sectionName of ['customers','companies']) {
    for (const [i,balance] of [1000,500,-200,0].entries()) {
      const created=await mutate('/api/'+sectionName,{requestId:'net-summary-'+sectionName+'-'+i,name:sectionName+' net '+i,openingBalance:Math.max(0,balance)});
      if(balance<0)await mutate('/api/'+sectionName+'/'+created.customer.id+'/transactions',{requestId:'net-payment-'+sectionName,expectedVersion:created.customer.version,type:'payment',inputValue:-balance,calculationMode:'direct'});
    }
  }
  const page=await writer.newPage();await page.goto(base+'/erp');
  for(const sectionName of ['customers','companies']) {
    await page.getByRole('button',{name:sectionName==='customers'?'قسم ديون العملاء':'قسم ديون الشركات',exact:true}).click();
    await expect(page.locator('.debt-total-card')).toContainText('صافي إجمالي الديون');
    await expect(page.locator('.debt-total-card strong')).toContainText(new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 }).format(1300));
    const full=await read(writer.request,'/api/'+sectionName+'?limit=1');
    assert.equal(full.summary.totalDebt,1500);
    assert.equal(full.summary.netBalance,1300);
    for(const filter of ['due','settled','pinned','today']) {
      const filtered=await read(writer.request,'/api/'+sectionName+'?filter='+filter+'&limit=1');
      assert.equal(filtered.summary.netBalance,1300);
    }
    const searched=await read(writer.request,'/api/'+sectionName+'?q=net%200&limit=1');
    assert.equal(searched.summary.netBalance,1300);
  }
  const treasury=await read(writer.request,'/api/treasury');
  assert.equal(treasury.sources.customers,1300);assert.equal(treasury.sources.companies,1300);assert.equal(treasury.receivablesUnits,2600);
  csrf = (await read(writer.request,'/api/auth/csrf')).csrfToken;
  const credit=await mutate('/api/customers',{requestId:'net-summary-larger-credit',name:'larger credit',openingBalance:0});
  await mutate('/api/customers/'+credit.customer.id+'/transactions',{requestId:'net-larger-credit-payment',expectedVersion:credit.customer.version,type:'payment',inputValue:2000,calculationMode:'direct'});
  await page.getByRole('button',{name:'قسم ديون العملاء',exact:true}).click();
  await expect(page.locator('.debt-total-card strong')).toContainText(new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 }).format(-700));
  const final=await read(writer.request,'/api/treasury');assert.equal(final.sources.customers,-700);assert.equal(final.receivablesUnits,600);
  console.log('PASS: signed net totals in both section headers match treasury; credits, zero, negative net, filters, search and pagination verified.');
} finally {
 await browser?.close();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));database.close();rmSync(directory,{recursive:true,force:true});
}
