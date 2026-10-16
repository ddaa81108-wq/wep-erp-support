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
  for(let day=0;day<5;day++) {
    let p=await read(writer.request,'/api/purchases/al_bayan');
    for(let j=0;j<3;j++) {
      await mutate('/api/purchases/al_bayan',{requestId:crypto.randomUUID(),expectedDayVersion:p.day.version,itemCode:j===0?'vodafone_cash':j===1?'cairo':'fawry',itemLabel:j===0?'فودافون كاش':j===1?'القاهرة':'فوري',egpValueUnits:5000,calculationMode:j===1?'multiply':'divide',exchangeRate:j===1?'0.2':'5',paidUnits:200,vodafoneConsumedUnits:0});
      p=await read(writer.request,'/api/purchases/al_bayan');
    }
    if(day<4) await mutate('/api/purchases/al_bayan/finalize',{requestId:crypto.randomUUID(),expectedDayVersion:p.day.version});
  }
  await mutate('/api/users',{username:'reader',displayName:'موظف قراءة',password:'Reader Test 123!',role:'employee',permissions:['purchases.read']});
  // Isolated visual fixture: include employee attribution alongside varied type labels.
  database.prepare("UPDATE purchase_entries SET actor_user_id=(SELECT id FROM users WHERE username='reader') WHERE sequence % 2 = 0").run();
  const page=await writer.newPage();
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/erp');
  await page.getByRole('button',{name:'قسم المشتريات',exact:true}).click();
  const register=page.locator('.purchase-register');
  await expect(page.locator('.purchase-row')).toHaveCount(15);
  await expect(page.locator('.purchase-day-closing')).toHaveCount(4);
  await expect(page.locator('.purchase-day-closing-value')).toHaveText(['2,400', '4,800', '7,200', '9,600']);
  await expect.poll(() => register.evaluate(e => e.scrollHeight - e.clientHeight - e.scrollTop)).toBeLessThan(2);
  await expect(page.getByRole('button',{name:'اعتماد الصف',exact:true})).toBeInViewport();
  await expect(page.locator('.purchase-register-grand-total')).toBeInViewport();
  await expect(page.locator('.purchase-vodafone-total')).toBeHidden();
  await expect(page.locator('.purchase-metrics .vodafone')).toBeInViewport();
  mkdirSync('artifacts/purchase-six',{recursive:true});
  await page.screenshot({path:'artifacts/purchase-six/initial-bottom.png',fullPage:true});
  for(const theme of ['light','dark']) {
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    for(const width of [1440,1920,390]) {
      await page.setViewportSize({width,height:1000});
      if(width<760 && await page.locator('.sidebar.open').count()>0) await page.getByRole('button',{name:'إغلاق القائمة الرئيسية',exact:true}).click();
      await page.waitForTimeout(400);
      await register.evaluate(e=>e.scrollTop=0);
      await expect(page.locator('.dashboard-utility-bar')).toBeInViewport();
      for(let tone=0;tone<5;tone++) {
        const cell=page.locator(`.purchase-day-tone-${tone} .purchase-row > span`).first();
        await expect(cell).toHaveCSS('border-radius','0px');
        await expect(cell).toHaveCSS('color',theme === 'light' ? 'rgb(48, 40, 24)' : 'rgb(255, 255, 255)');
      }
      await page.screenshot({path:`artifacts/purchase-six/${theme}-${width}.png`,fullPage:true});
      await register.evaluate(e=>e.scrollTop=e.scrollHeight);
      await expect(page.locator('.dashboard-utility-bar')).toBeInViewport();
      await expect(page.locator('.purchase-grid-head')).toBeInViewport();
      await page.screenshot({path:`artifacts/purchase-six/${theme}-${width}-entry.png`,fullPage:true});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.locator('.purchase-saved-mark')).toHaveCount(12);
  await page.getByRole('button',{name:'تعديل اليوم',exact:true}).first().click();
  await expect(page.locator('.purchase-saved-mark')).toHaveCount(9);
  await expect(page.getByRole('button',{name:'إنهاء تعديل اليوم',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'إنهاء تعديل اليوم',exact:true}).click();
  await expect(page.locator('.purchase-saved-mark')).toHaveCount(12);
  await page.getByLabel('القيمة ج.م',{exact:true}).fill('500');
  await page.getByLabel('سعر الصرف',{exact:true}).fill('5');
  await page.getByLabel('المسدد',{exact:true}).fill('20');
  await page.getByRole('button',{name:'اعتماد الصف',exact:true}).click();
  await expect(page.locator('.purchase-row')).toHaveCount(16);
  await expect(page.locator('.purchase-day-closing-value')).toHaveText(['2,400', '4,800', '7,200', '9,600']);
  const saved=await read(writer.request,'/api/purchases/al_bayan');
  assert.equal(saved.day.todayResultUnits,3100);
  assert.equal(saved.day.todayPaidUnits,620);

  database.prepare("UPDATE users SET must_change_password=0 WHERE username='reader'").run();
  const reader=await browser.newContext();
  await reader.request.post(base+'/api/auth/login',{headers:{'X-Client-Api-Version':'1'},data:{username:'reader',password:'Reader Test 123!'}});
  const readerPage=await reader.newPage();await readerPage.goto(base+'/erp');
  await readerPage.getByRole('button',{name:'قسم المشتريات',exact:true}).click();
  await expect(readerPage.locator('.purchase-row')).toHaveCount(16);
  await expect(readerPage.getByRole('button',{name:'اعتماد الصف'})).toHaveCount(0);
  await expect(readerPage.getByRole('button',{name:'ترحيل اليوم'})).toHaveCount(0);
  await expect(readerPage.locator('.purchase-actions button')).toHaveCount(0);
  console.log('PASS purchase presentation: five day colors, desktop/phone/light/dark, sticky toolbar/header, calculation and read-only permissions.');
} finally {
  await browser?.close();server.closeRealtimeConnections();
  await new Promise<void>(done=>server.close(()=>done()));database.close();rmSync(directory,{recursive:true,force:true});
}


