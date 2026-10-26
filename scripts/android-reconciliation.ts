/** Only operates against the loopback synthetic sandbox created by android-staging.ts. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium, expect } from '@playwright/test';
const current = JSON.parse(readFileSync('var/android-staging/current.json','utf8'));
const run = resolve(current.run);
assert.ok(run.startsWith(resolve('var/android-staging') + sep));
assert.equal(current.baseUrl,'http://127.0.0.1:4311');
const manifest = JSON.parse(readFileSync(join(run,'manifest.json'),'utf8'));
assert.equal(manifest.synthetic,true);
const accounts = JSON.parse(readFileSync(join(run,'credentials.private.json'),'utf8')).accounts;
const out = resolve('artifacts/android-integration');
mkdirSync(out,{recursive:true});
const browser = await chromium.launch();
const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'ar-LY'});
const samples: Record<string,unknown> = {};
try {
  const login = await context.request.post(current.baseUrl+'/api/auth/login',{data:{username:accounts[0].username,password:accounts[0].password},headers:{'X-Client-Api-Version':'1'}});
  assert.equal(login.status(),200);
  const loginJson = await login.json();
  samples.login = {status:200,body:{...loginJson,data:{...loginJson.data,csrfToken:'<session-csrf-token>'}}};
  const headers = {'X-CSRF-Token':loginJson.data.csrfToken,'X-Client-Api-Version':'1'};
  async function call(path: string, method='GET', data?: unknown, extraHeaders=headers) {
    const response = await context.request.fetch(current.baseUrl+path,{method,headers:extraHeaders,...(data===undefined?{}:{data})});
    return {status:response.status(),body:await response.json()};
  }
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(current.baseUrl+'/erp');
  await expect(page.locator('.customer-card-main').first()).toBeVisible({timeout:20000});
  const snapshots: Record<string,unknown> = {};
  async function section(label: string, ready: string, filename: string) {
    await page.locator('.sidebar nav').getByRole('button',{name:label,exact:true}).click();
    await expect(page.locator(ready).first()).toBeVisible({timeout:15000});
    await page.screenshot({path:join(out,filename),fullPage:true});
  }
  async function ledger(filename: string, expectedBalance: number) {
    await page.locator('.customer-card-main').filter({hasText:'عميل المطابقة ألف'}).click();
    await expect(page.locator('.ledger-panel')).toBeVisible();
    const snapshot = await call(`/api/customers/${manifest.customerId}/ledger`);
    assert.equal(snapshot.body.data.customer.balanceUnits,expectedBalance);
    await expect(page.locator('.ledger-record')).toHaveCount(expectedBalance===1000?1:expectedBalance===750?2:3);
    await page.screenshot({path:join(out,filename),fullPage:true});
    await page.getByRole('button',{name:'إغلاق السجل',exact:true}).click();
    return snapshot;
  }
  for (const path of ['/api/me','/api/customers','/api/companies','/api/libyan-deposits','/api/egyptian-deposits','/api/egyptian-deposits/exchange-rate','/api/purchases/al_bayan','/api/purchases/simsim','/api/treasury','/api/collections','/api/collections/payroll','/api/notifications','/api/reports','/api/organization-settings','/api/notification-preferences','/api/collections/assignees','/api/health','/api/masraweya/day','/api/users','/api/audit-log','/api/financial-ledger','/api/event-changes?after=0','/api/account-requests']) {
    const result = await call(path); assert.equal(result.status,200,path); samples[`GET ${path}`]=result;
  }
  snapshots.initial = Object.fromEntries(Object.entries(samples).filter(([key])=>key.startsWith('GET ')));
  await page.screenshot({path:join(out,'01-customer-total.png'),fullPage:true});
  samples.initialLedger = await ledger('03-customer-initial.png',1000);
  await section('قسم ديون الشركات','.customer-card-main','02-company-total.png');
  await section('أمانات ليبية','.customer-card-main','06-libyan-deposits.png');
  await section('أمانات مصرية','.customer-card-main','07-egyptian-deposits.png');
  await section('قسم المشتريات','.purchase-register','08-purchases.png');
  await section('الخزينة','.treasury-cards','09-treasury.png');
  await section('قسم استلامات الديون','.collections-page','10-collections.png');
  await section('قسم ديون العملاء','.customer-card-main','01-customer-total.png');
  const version = samples.initialLedger.body.data.customer.version;
  // The site rotates CSRF on bootstrap; use the session's current token.
  const csrf = await call('/api/auth/csrf');
  headers['X-CSRF-Token'] = csrf.body.data.csrfToken;
  const path = `/api/customers/${manifest.customerId}/transactions`;
  const partial = {requestId:'android-reconcile-partial-250',expectedVersion:version,type:'payment',paymentMode:'partial',calculationMode:'direct',inputValue:250,note:'مطابقة Android مصطنعة',checkDuplicate:true};
  samples.csrfError = await call(path,'POST',partial,{'X-CSRF-Token':'invalid','X-Client-Api-Version':'1'});
  assert.equal(samples.csrfError.body.error.code,'CSRF_REJECTED');
  samples.versionHeaderError = await call(path,'POST',partial,{'X-CSRF-Token':headers['X-CSRF-Token'],'X-Client-Api-Version':'0'});
  assert.equal(samples.versionHeaderError.body.error.code,'CLIENT_VERSION_MISMATCH');
  samples.invalidAmount = await call(path,'POST',{...partial,inputValue:0.5});
  assert.equal(samples.invalidAmount.body.error.code,'INVALID_AMOUNT');
  samples.partial = await call(path,'POST',partial);
  assert.equal(samples.partial.status,201);
  assert.equal(samples.partial.body.data.balanceUnits,750);
  samples.replay = await call(path,'POST',partial);
  assert.equal(samples.replay.body.meta.replayed,true);
  samples.reusedId = await call(path,'POST',{...partial,inputValue:251});
  assert.equal(samples.reusedId.body.error.code,'REQUEST_ID_REUSED');
  samples.versionConflict = await call(path,'POST',{...partial,requestId:'android-reconcile-stale-version'});
  assert.equal(samples.versionConflict.body.error.code,'VERSION_CONFLICT');
  samples.duplicateWarning = await call(path,'POST',{...partial,requestId:'android-reconcile-duplicate',expectedVersion:version+1});
  assert.equal(samples.duplicateWarning.body.error.code,'DUPLICATE_SAME_WORKDAY');
  await page.reload(); await expect(page.locator('.customer-card-main').first()).toBeVisible();
  snapshots.afterPartial = await ledger('04-customer-after-partial.png',750);
  headers['X-CSRF-Token'] = (await call('/api/auth/csrf')).body.data.csrfToken;
  samples.full = await call(path,'POST',{requestId:'android-reconcile-full-750',expectedVersion:version+1,type:'payment',paymentMode:'full',calculationMode:'direct',inputValue:750,note:'مطابقة سداد كلي مصطنع',checkDuplicate:true});
  assert.equal(samples.full.status,201); assert.equal(samples.full.body.data.balanceUnits,0);
  await page.reload(); await expect(page.locator('.customer-card-main').first()).toBeVisible();
  snapshots.afterFull = await ledger('05-customer-after-full.png',0);
  const limitedContext = await browser.newContext();
  for (const [index, ctx] of [[1,limitedContext],[2,await browser.newContext()]] as const) {
    const account = accounts[index];
    const result = await ctx.request.post(current.baseUrl+'/api/auth/login',{data:{username:account.username,password:account.password}});
    assert.equal(result.status(),200);
    const json = await result.json();
    samples[index===1?'limitedMe':'collectorMe'] = {status:200,body:await (await ctx.request.get(current.baseUrl+'/api/me')).json()};
    const denied = await ctx.request.post(current.baseUrl+'/api/collections/assignments',{headers:{'X-CSRF-Token':json.data.csrfToken,'X-Client-Api-Version':'1'},data:{}});
    assert.equal(denied.status(),403);
    samples[index===1?'limitedForbidden':'collectorForbidden']={status:denied.status(),body:await denied.json()};
    await ctx.close();
  }
  const unauth = await browser.newContext();
  const denied = await unauth.request.get(current.baseUrl+'/api/me');
  samples.unauthenticated = {status:denied.status(),body:await denied.json()};
  assert.equal(denied.status(),401); await unauth.close();
  assert.deepEqual(errors,[]);
  writeFileSync(join(out,'api-samples.json'),JSON.stringify(samples,null,2));
  writeFileSync(join(out,'reconciliation.json'),JSON.stringify({synthetic:true,capturedAt:new Date().toISOString(),manifest,snapshots,screenshots:['01-customer-total.png','02-company-total.png','03-customer-initial.png','04-customer-after-partial.png','05-customer-after-full.png','06-libyan-deposits.png','07-egyptian-deposits.png','08-purchases.png','09-treasury.png','10-collections.png'],checks:{partial:750,full:0,replay:true,requestIdReuse:true,versionConflict:true,csrf:true,permissions:true,uiErrors:errors}},null,2));
  console.log('PASS synthetic reconciliation, role restrictions, CSRF, version conflict, replay and 10 site screenshots.');
} finally { await context.close();await browser.close(); }
