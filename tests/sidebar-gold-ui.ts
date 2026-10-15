import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser } from '@playwright/test';
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
  mkdirSync('artifacts/sidebar-gold',{recursive:true});
  await mutate('/api/users',{username:'reader',displayName:'موظف الاختبار',password:'Reader Test 123!',role:'employee',permissions:['libyan_deposits.read']});
  const page = await writer.newPage();
  await page.clock.install({time: new Date('2026-10-15T12:00:00Z')});
  await page.goto(base+'/erp');
  const sidebar = page.locator('.sidebar');
  for (const theme of ['light','dark']) {
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:900}); await page.waitForTimeout(350);
      if(width===390) await page.getByRole('button',{name:'فتح القائمة الرئيسية',exact:true}).click();
      await expect(sidebar).toBeInViewport();
      await expect(sidebar.locator('nav button')).toHaveCount(10);
      await expect(sidebar.locator('nav button.active')).toHaveCSS('color','rgb(36, 24, 14)');
      assert.ok(await sidebar.locator('nav button').evaluateAll(nodes=>nodes.every(e=>e.scrollWidth<=e.clientWidth+1)));
      await page.waitForTimeout(300);
      await page.screenshot({path:`artifacts/sidebar-gold/admin-${theme}-${width}.png`,fullPage:true});
      if(width===390) await page.getByRole('button',{name:'إغلاق القائمة الرئيسية',exact:true}).click();
    }
  }
  for (const palette of ['gold','blue','red','orange','green','black']) {
    await sidebar.evaluate((node, value)=>{node.setAttribute('data-palette',value);},palette);
    for (const theme of ['light','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      for (const width of [1440,390]) {
        await page.setViewportSize({width,height:900}); await page.waitForTimeout(350);
        if(width===390) await page.getByRole('button',{name:'فتح القائمة الرئيسية',exact:true}).click();
        await page.waitForTimeout(300);
        await expect(sidebar).toBeInViewport();
        await expect(sidebar.locator('nav button.active')).toHaveCSS('color',palette==='black'?'rgb(255, 255, 255)':({gold:'rgb(36, 24, 14)',blue:'rgb(3, 20, 37)',red:'rgb(33, 1, 7)',orange:'rgb(38, 19, 0)',green:'rgb(1, 35, 14)'}[palette]!));
        await sidebar.screenshot({path:`artifacts/sidebar-gold/${palette}-${theme}-${width}.png`});
        if(width===390) await page.getByRole('button',{name:'إغلاق القائمة الرئيسية',exact:true}).click();
      }
    }
  }
  await sidebar.evaluate(node=>node.setAttribute('data-palette','gold'));
  await page.clock.fastForward(10 * 60 * 60 * 1000 + 100);
  await expect(sidebar).toHaveAttribute('data-palette','blue');
  await page.setViewportSize({width:1440,height:900});
  await sidebar.getByRole('button',{name:'أمانات ليبية',exact:true}).click();
  await expect(sidebar.getByRole('button',{name:'أمانات ليبية',exact:true})).toHaveClass('active');
  await page.getByRole('button',{name:'إخفاء الشريط الجانبي',exact:true}).click();
  await expect(sidebar).not.toBeInViewport();
  await page.getByRole('button',{name:'إظهار الشريط الجانبي',exact:true}).click();
  await expect(sidebar).toBeInViewport();

  database.prepare("UPDATE users SET must_change_password=0 WHERE username='reader'").run();
  const employee = await browser.newContext();
  await employee.request.post(base+'/api/auth/login',{headers:{'X-Client-Api-Version':'1'},data:{username:'reader',password:'Reader Test 123!'}});
  const employeePage = await employee.newPage();
  await employeePage.goto(base+'/erp');
  for (const theme of ['light','dark']) {
    await employeePage.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    for (const width of [1440,390]) {
      await employeePage.setViewportSize({width,height:900}); await employeePage.waitForTimeout(350);
      if(width===390) await employeePage.getByRole('button',{name:'فتح القائمة الرئيسية',exact:true}).click();
      await expect(employeePage.locator('.sidebar nav button:disabled')).toHaveCount(8);
      await expect(employeePage.locator('.sidebar nav button:not(:disabled)')).toHaveCount(1);
      await employeePage.waitForTimeout(300);
      await employeePage.screenshot({path:`artifacts/sidebar-gold/employee-${theme}-${width}.png`,fullPage:true});
      if(width===390) await employeePage.getByRole('button',{name:'إغلاق القائمة الرئيسية',exact:true}).click();
    }
  }
  console.log('PASS gold sidebar: desktop/phone, light/dark, administrator/employee, navigation, hide/reveal, permission locks unchanged.');
} finally {
  await browser?.close();
  server.closeRealtimeConnections();
  await new Promise<void>(done=>server.close(()=>done()));
  database.close();
  rmSync(directory,{recursive:true,force:true});
}