import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { reportOverviewFixture } from './helpers/reportOverviewFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { treasuryDashboard } from '../src/server/domain/treasury.ts';

const {db,admin,customerId}=reportOverviewFixture();
const server=createApp(db,loadConfig({databasePath:':memory:',publicOrigin:'',secureCookie:false,internetRequired:false,pushPublicKey:'',pushPrivateKey:''}));
const browser=await chromium.launch();
try {
  await listen(server,'127.0.0.1',0);
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const viewer=await browser.newContext({viewport:{width:1440,height:1000}});
  await viewer.addCookies([{name:'abdo_session',value:createSession(db,admin.id,'1',12).token,url:base}]);
  await viewer.addInitScript(()=>{
    const native=EventSource.prototype.addEventListener;
    EventSource.prototype.addEventListener=function(this:EventSource,type:string,listener:EventListenerOrEventListenerObject,options?:boolean|AddEventListenerOptions) {
        native.call(this,type,event=>{
          if(type==='treasury.changed'&&(window as unknown as {suppressCash:boolean}).suppressCash)return;
          if(typeof listener==='function')listener.call(this,event);else listener.handleEvent(event);
        },options);
    } as typeof native;
  });
  const page=await viewer.newPage(),errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  let cashReads=0;
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/treasury/cash-ledger')cashReads++;});
  await page.goto(base+'/erp');
  await page.locator('.sidebar nav').getByRole('button',{name:'الخزينة',exact:true}).click();
  await expect(page.locator('.treasury-card.active-cash')).toBeVisible();
  await page.waitForTimeout(200);
  const writer=await browser.newContext();
  const session=createSession(db,admin.id,'1',12);
  await writer.addCookies([{name:'abdo_session',value:session.token,url:base}]);
  const headers={'X-CSRF-Token':session.csrfToken,'X-Client-Api-Version':'1'};
  const money=(value:number)=>new Intl.NumberFormat('en-US').format(value);
  async function customerWrite(index:number) {
    const version=Number(db.prepare('SELECT version FROM customers WHERE id=?').get(customerId)!.version);
    const response=await writer.request.post(`${base}/api/customers/${customerId}/transactions`,{headers,data:{
      requestId:`treasury-refresh-customer-${index}`,expectedVersion:version,type:'debt',inputValue:17,calculationMode:'direct',
    }});
    assert.equal(response.status(),201,await response.text());
    await expect(page.locator('.treasury-card.receivable b')).toContainText(money(treasuryDashboard(db,admin.organizationId).receivablesUnits));
  }
  const initialReads=cashReads,initialEntries=await page.locator('.treasury-ledger').textContent();
  for(let i=0;i<3;i++)await customerWrite(i);
  assert.equal(cashReads,initialReads,'account-only commits do not reload independent cash history');
  assert.equal(await page.locator('.treasury-ledger').textContent(),initialEntries);
  async function cashWrite(index:number) {
    const current=treasuryDashboard(db,admin.organizationId);
    const response=await writer.request.post(base+'/api/treasury/cash-entries',{headers,data:{
      requestId:`treasury-refresh-cash-${index}`,expectedVersion:current.cashVersion,direction:'in',amountUnits:23,
      description:`cash refresh ${index}`,
    }});
    assert.equal(response.status(),201,await response.text());
    await expect(page.locator('.treasury-ledger-row').filter({hasText:`cash refresh ${index}`})).toBeVisible();
    await expect(page.locator('.treasury-card.active-cash b')).toContainText(money(current.activeCashUnits+23));
  }
  await cashWrite(1);
  assert.ok(cashReads>initialReads,'cash commits still reload cash history');
  await page.evaluate(()=>{(window as unknown as {suppressCash:boolean}).suppressCash=true;});
  const beforeMissed=cashReads;
  // Deliberately omit only the live cash notice. The next account commit must
  // discover the cash-version change, not retain a stale history.
  const current=treasuryDashboard(db,admin.organizationId);
  const missed=await writer.request.post(base+'/api/treasury/cash-entries',{headers,data:{
    requestId:'treasury-refresh-missed-cash',expectedVersion:current.cashVersion,direction:'in',amountUnits:29,description:'missed cash event',
  }});
  assert.equal(missed.status(),201,await missed.text());
  await customerWrite(4);
  await expect(page.locator('.treasury-ledger-row').filter({hasText:'missed cash event'})).toBeVisible();
  assert.ok(cashReads>beforeMissed,'version check repairs a missed cash event');
  assert.deepEqual(errors,[]);
  console.log(`PASS: three account commits used zero cash-history reads; real and missed cash events refreshed correctly. Synthetic DB only.`);
} finally {
  await browser.close();server.closeRealtimeConnections();server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();
}
