import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { createApp, listen } from '../src/server/app.ts';
import { openDatabase } from '../src/server/db/database.ts';
import type { ServerConfig } from '../src/server/config.ts';
const dir = mkdtempSync(join(tmpdir(), 'notification-buttons-'));
const db = openDatabase(join(dir, 'test.sqlite'));
const config: ServerConfig = { host:'127.0.0.1',port:0,databasePath:':memory:',sessionHours:12,secureCookie:false,internetRequired:false,internetProbeUrls:[],internetProbeTimeoutMs:100,internetProbeCacheMs:100 };
const server = createApp(db, config);
const browser = await chromium.launch();
const output = resolve('artifacts/notification-buttons');
mkdirSync(output,{recursive:true});
try {
  await listen(server,config.host,0);
  const base='http://127.0.0.1:'+(server.address() as AddressInfo).port;
  const context=await browser.newContext({viewport:{width:1440,height:950}});
  assert.ok((await context.request.post(base+'/api/setup/admin',{data:{username:'admin',displayName:'مدير الاختبار',password:'Notification Test 123!'}})).ok());
  await context.request.post(base+'/api/auth/login',{headers:{'X-Client-Api-Version':'1'},data:{username:'admin',password:'Notification Test 123!'}});
  const page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/erp');
  const open = async () => page.getByRole('button',{name:'الإشعارات',exact:true}).click();
  await open();
  const sound=page.locator('.notification-toggle').filter({hasText:'الصوت'});
  const speech=page.locator('.notification-toggle').filter({hasText:'النطق'});
  await expect(sound).toContainText('مفعّل');await expect(sound).toBeEnabled();
  await expect(speech).toContainText('متوقف');
  await sound.click();await expect(sound).toHaveAttribute('aria-pressed','false');await expect(sound).toContainText('متوقف');
  await speech.click();await expect(speech).toHaveAttribute('aria-pressed','true');await expect(speech).toContainText('مفعّل');
  await page.reload();await open();
  await expect(sound).toContainText('متوقف');await expect(speech).toContainText('مفعّل');
  await page.route('**/api/notification-preferences',async route=>{
    if(route.request().method()==='PATCH')await route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'TEST_FAILURE',message:'test'}})});
    else await route.continue();
  });
  await sound.click();await expect(page.getByRole('alert')).toContainText('لم يتم حفظ');
  await expect(sound).toHaveAttribute('aria-pressed','false');await expect(sound).toBeEnabled();
  await page.unroute('**/api/notification-preferences');
  let release!:()=>void;
  const held = new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/notification-preferences',async route=>{
    if(route.request().method()==='PATCH')await held;
    await route.continue();
  });
  await sound.click();await expect(sound).toBeDisabled();await expect(speech).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('جارٍ حفظ');
  release();await expect(sound).toHaveAttribute('aria-pressed','true');await expect(sound).toBeEnabled();
  await page.unroute('**/api/notification-preferences');
  await speech.click();await expect(speech).toHaveAttribute('aria-pressed','false');
  for(const theme of ['light','dark']){
    await page.setViewportSize({width:1440,height:950});
    await page.getByRole('button',{name:'إغلاق',exact:true}).click();
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:theme==='dark'?'المظهر الليلي':'المظهر النهاري',exact:true}).click();
    await open();
    for(const width of [1440,390]){
      await page.setViewportSize({width,height:950});
      if (width === 390) await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().left >= innerWidth)).toBe(true);
      await expect(sound).toBeVisible();await expect(speech).toBeVisible();
      assert.notEqual(await sound.evaluate(el=>getComputedStyle(el).backgroundColor),await speech.evaluate(el=>getComputedStyle(el).backgroundColor));
      assert.ok(await page.locator('.notification-panel').evaluate(el=>{const b=el.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;}));
      await page.screenshot({path:join(output,theme+'-'+width+'.png')});
    }
  }
  db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
    SELECT 'notification-employee','employee','موظف الاختبار',password_hash,'employee',organization_id,home_branch_id,created_at,updated_at FROM users WHERE username='admin'`).run();
  db.prepare("INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES('notification-employee','collections.read',1,?)").run(new Date().toISOString());
  const employeeContext = await browser.newContext({viewport:{width:390,height:950}});
  await employeeContext.request.post(base+'/api/auth/login',{headers:{'X-Client-Api-Version':'1'},data:{username:'employee',password:'Notification Test 123!'}});
  const employeePage = await employeeContext.newPage();
  employeePage.on('pageerror',e=>errors.push(e.message));
  await employeePage.goto(base+'/erp');
  await employeePage.getByRole('button',{name:'الإشعارات',exact:true}).click();
  const employeeSound = employeePage.locator('.notification-toggle').filter({hasText:'الصوت'});
  await expect(employeeSound).toBeEnabled();
  await employeeSound.click();await expect(employeeSound).toContainText('متوقف');
  await employeePage.reload();await employeePage.getByRole('button',{name:'الإشعارات',exact:true}).click();
  await expect(employeeSound).toContainText('متوقف');
  const adminPreferences = await (await context.request.get(base+'/api/notification-preferences')).json();
  assert.equal(adminPreferences.data.soundEnabled,true,'Employee preferences do not change administrator preferences.');
  assert.deepEqual(errors,[]);
  console.log('PASS notification settings: saved state, reload persistence, failed save, pending lock, both themes and viewports.');
} finally {
 await browser.close();await new Promise<void>(done=>server.close(()=>done()));db.close();rmSync(dir,{recursive:true,force:true});
}
