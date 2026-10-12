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
  await mutate('/api/users', { username:'collector', displayName:'موظف الاختبار', password:'Live Collector 123!', role:'employee', permissions:['collections.read','collections.write'] });
  database.prepare("UPDATE users SET must_change_password=0 WHERE username='collector'").run();
  const collector=await browser.newContext();
  const collectorLogin=await collector.request.post(base+'/api/auth/login',{headers:{'X-Client-Api-Version':'1'},data:{username:'collector',password:'Live Collector 123!'}});
  const collectorCsrf=(await collectorLogin.json()).data.csrfToken;
  const collectorId=String((database.prepare("SELECT id FROM users WHERE username='collector'").get() as {id:string}).id);
  const submit=async (id:string,mode:string,amountUnits:number)=>{
    const response=await collector.request.post(base+'/api/collections/assignments/'+id+'/submissions',{headers:{'X-Client-Api-Version':'1','X-CSRF-Token':collectorCsrf},data:{mode,amountUnits}});
    assert.ok(response.ok(),await response.text());return (await response.json()).data;
  };
  const names=['جديد أزرق','سداد جزئي أصفر','مسدد أسود','نقدية مسلمة أحمر','أمانة أخضر','استلام مرفوض'];
  const ids:string[]=[];
  for(const [i,name] of names.entries()) {
    const account=await mutate('/api/customers',{name,openingBalance:100,requestId:'colour-account-'+i});
    ids.push(account.customer.id);
    const assignment=await mutate('/api/collections/assignments',{customerIds:[account.customer.id],assigneeUserId:collectorId,section:'customers'});
    const id=assignment.assignmentIds[0];
    if([1,2,3,5].includes(i)) {
      const payment=await submit(id,i===1||i===5?'partial':'full',i===1||i===5?30:100);
      await mutate('/api/collections/submissions/'+payment.id+'/decision',{decision:i===5?'reject':'approve'});
      if(i===1||i===3) await mutate('/api/collections/submissions/'+payment.id+'/cash-received',{});
    }
    if(i===4) await mutate('/api/customers/'+account.customer.id+'/transactions',{requestId:'colour-credit',expectedVersion:1,type:'payment',inputValue:120,calculationMode:'direct'});
  }
  // Give fixtures a deterministic history; following edits still use the real API/events.
  database.prepare("UPDATE debt_transactions SET created_at='2000-01-01',updated_at='2000-01-01'").run();
  database.prepare("UPDATE debt_assignments SET assigned_at='2001-01-01'").run();
  const viewer=await browser.newContext();
  await viewer.request.post(base+'/api/auth/login',{headers:{'X-Client-Api-Version':'1'},data:{username:'admin',password:'Live Admin 123!'}});
  const adminPage=await viewer.newPage();
  const employeePage=await collector.newPage();
  for(const page of [adminPage,employeePage]) {
    await page.goto(base+'/erp');
    await page.getByRole('button',{name:'قسم استلامات الديون',exact:true}).click();
    await page.locator('.collections-page').waitFor();
    const cards=page===adminPage?page.locator('.admin-collection-grid > .admin-customer-collection-card'):page.locator('.collection-grid > .collection-card');
    await expect(cards).toHaveCount(6);
    for(const [i,tone] of ['collection-base','collection-yellow','zero-collection-card','collection-red','collection-green','collection-rejected'].entries()) {
      await expect(cards.filter({hasText:names[i]})).toHaveClass(new RegExp(tone));
    }
    await expect(cards.last()).toContainText('تم الرفض');
    await expect(cards.last().locator('.collection-rejected-badge svg')).toBeVisible();
    const order=await cards.evaluateAll(elements=>elements.map(e=>e.className));
    assert.ok(order[0].includes('collection-base'));
    assert.ok(order[1].includes('collection-yellow'));
    assert.ok(order[2].includes('collection-green'));
    mkdirSync(resolve('artifacts','collection-states'),{recursive:true});
    for(const theme of ['light','dark']) {
      await page.setViewportSize({width:1440,height:950});
      if (await page.evaluate(()=>document.documentElement.dataset.theme) !== theme) {
        await page.getByRole('button',{name:theme==='dark'?'المظهر الليلي':'المظهر النهاري',exact:true}).click();
      }
      for(const width of [390,1440]) {
        await page.setViewportSize({width,height:950});
        if (width===390) await expect.poll(()=>page.locator('.sidebar').evaluate(el=>el.getBoundingClientRect().left>=innerWidth)).toBe(true);
        await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
        const rejectedBox = await cards.last().boundingBox();
        const otherBottom = await cards.locator('..').evaluate(() => 0).catch(() => 0);
        void otherBottom;
        const normalBottom = await cards.evaluateAll(elements => Math.max(...elements.filter(el => !el.classList.contains('collection-rejected')).map(el => el.getBoundingClientRect().bottom)));
        assert.ok(rejectedBox && rejectedBox.y >= normalBottom, 'Rejected cards must start below every other card.');
        assert.ok(rejectedBox.width <= 181, 'Rejected cards stay compact.');
        if (page === adminPage) {
          const desktopActions = page.locator('.collection-desktop-batch-actions');
          if (width === 390) {
            await expect(desktopActions.getByRole('button', { name: 'كشف PDF', exact: true })).toBeHidden();
            await expect(page.locator('.day-actions')).toBeVisible();
          } else {
            await expect(desktopActions.getByRole('button', { name: 'كشف PDF', exact: true })).toBeVisible();
            await expect(page.locator('.day-actions')).toBeHidden();
          }
        }
        await page.screenshot({path:resolve('artifacts','collection-states',(page===adminPage?'admin':'employee')+'-'+theme+'-'+width+'.png'),fullPage:true,animations:'disabled'});
      }
    }
  }
  await employeePage.locator('.collection-rejected .rejected-card-details > summary').click();
  await expect(employeePage.locator('.collection-rejected .collector-actions')).toBeVisible();
  await adminPage.locator('.collection-desktop-batch-actions').getByRole('button', { name: 'إغلاق ومسح الدفعة', exact: true }).click();
  await expect(adminPage.getByRole('dialog')).toBeVisible();
  await adminPage.getByRole('dialog').getByRole('button', { name: 'لا', exact: true }).click();
  const account=await read(writer.request,'/api/customers/'+ids[2]);
  const version=account.customer?.version ?? account.version;
  await mutate('/api/customers/'+ids[2]+'/transactions',{requestId:'colour-admin-promote',expectedVersion:version,type:'debt',inputValue:40,calculationMode:'direct'});
  await expect(adminPage.locator('.admin-collection-grid > .admin-customer-collection-card').first()).toContainText(names[2],{timeout:7000});
  await expect(employeePage.locator('.collection-grid > .collection-card').first()).toContainText(names[2],{timeout:7000});
  console.log('PASS collections: all colours, rejection badge, employee/admin ordering, mobile/desktop and light/dark, realtime administrative promotion.');
} finally {
  await browser?.close();
  await new Promise<void>(done=>server.close(()=>done()));
  database.close();
  rmSync(directory,{recursive:true,force:true});
}
