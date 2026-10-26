import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { chromium } from '@playwright/test';
const state=JSON.parse(readFileSync('var/android-staging/current.json','utf8'));
const run=resolve(state.run);
assert.ok(run.startsWith(resolve('var/android-staging')+sep));
const manifest=JSON.parse(readFileSync(join(run,'manifest.json'),'utf8'));
assert.equal(manifest.synthetic,true);
const accounts=JSON.parse(readFileSync(join(run,'credentials.private.json'),'utf8')).accounts;
const base='https://staging.vip2100.com';
const browser=await chromium.launch();
const context=await browser.newContext({viewport:{width:1440,height:1000}});
try {
  const health=await context.request.get(base+'/api/health');
  assert.equal(health.status(),200);
  const healthBody=await health.json();assert.equal(healthBody.data.status,'ready');
  assert.equal(healthBody.data.build.commit,manifest.sourceCommit);
  const response=await context.request.post(base+'/api/auth/login',{data:{username:accounts[0].username,password:accounts[0].password}});
  assert.equal(response.status(),200);
  const sessionHeader=response.headersArray().find(h=>h.name.toLowerCase()==='set-cookie'&&h.value.startsWith('abdo_session='))?.value??'';
  assert.match(sessionHeader,/; Secure/i);assert.match(sessionHeader,/HttpOnly/i);assert.match(sessionHeader,/SameSite=Strict/i);
  const data: Record<string,unknown>={};
  for(const path of ['/api/me','/api/customers','/api/companies','/api/libyan-deposits','/api/egyptian-deposits','/api/purchases/al_bayan','/api/treasury','/api/collections']){
    const result=await context.request.get(base+path);assert.equal(result.status(),200,path);data[path]=(await result.json()).data;
  }
  const initial=JSON.parse(readFileSync('artifacts/android-integration/reconciliation.json','utf8')).snapshots.initial;
  const customers=data['/api/customers'] as {items:Array<{id:string;balanceUnits:number}>;summary:{totalDebt:number}};
  assert.equal(customers.items.find(x=>x.id===manifest.customerId)?.balanceUnits,0);
  assert.equal(customers.summary.totalDebt,initial['GET /api/customers'].body.data.summary.totalDebt-1000);
  assert.equal((data['/api/treasury'] as {netUnits:number}).netUnits,initial['GET /api/treasury'].body.data.netUnits-1000);
  for(const path of ['/api/companies','/api/libyan-deposits','/api/egyptian-deposits']) assert.deepEqual((data[path] as {summary:unknown}).summary,initial['GET '+path].body.data.summary);
  assert.deepEqual((data['/api/collections'] as {metrics:unknown}).metrics,initial['GET /api/collections'].body.data.metrics);
  const page=await context.newPage();
  await page.goto(base+'/erp',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('.customer-card-main').first().waitFor({state:'visible',timeout:45000});
  await page.screenshot({path:'artifacts/android-integration/11-public-staging.png',fullPage:true});
  const csrf=(await (await context.request.get(base+'/api/auth/csrf')).json()).data.csrfToken;
  const logout=await context.request.post(base+'/api/auth/logout',{headers:{'X-CSRF-Token':csrf,'X-Client-Api-Version':'1'}});assert.equal(logout.status(),200);
  const report={baseUrl:base,checkedAt:new Date().toISOString(),synthetic:true,health:healthBody,https:true,secureCookie:true,httpOnlyCookie:true,sameSite:'Strict',publicLogin:true,publicLogout:true,financialComparison:'matches local phase after full payment',data};
  writeFileSync('artifacts/android-integration/public-verification.json',JSON.stringify(report,null,2));
  console.log('PASS public HTTPS staging: secure session, login/logout, source commit and financial snapshot match.');
} finally {await context.close();await browser.close();}
