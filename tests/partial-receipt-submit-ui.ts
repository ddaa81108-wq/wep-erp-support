import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { decideCollection } from '../src/server/domain/collections.ts';

const {db,collector,admin,ids}=collectionFixture();
const server=createApp(db,loadConfig({databasePath:':memory:',publicOrigin:'',secureCookie:false,internetRequired:false}));
const browser=await chromium.launch();
const errors:string[]=[],posts:Record<string,unknown>[]=[];
let releasePost!:()=>void,releaseReads!:()=>void;
const postGate=new Promise<void>(resolve=>{releasePost=resolve;});
const readGate=new Promise<void>(resolve=>{releaseReads=resolve;});
let holdReads=false;
mkdirSync('artifacts/partial-receipt-submit',{recursive:true});
try {
  await listen(server,'127.0.0.1',0);
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const context=await browser.newContext({viewport:{width:1440,height:950}});
  await context.addCookies([{name:'abdo_session',value:createSession(db,collector.id,'1',12).token,url:base}]);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/collections**',async route=>{
    if(route.request().method()==='GET'&&holdReads)await readGate;
    if(route.request().method()==='POST'&&/\/assignments\/[^/]+\/submissions$/.test(new URL(route.request().url()).pathname)){
      posts.push(route.request().postDataJSON());
      if(posts.length===1)await postGate;
    }
    await route.continue();
  });
  await page.goto(base+'/erp');
  await page.getByRole('button',{name:'قسم استلامات الديون',exact:true}).click();
  await expect(page.locator('.employee-collections-page')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  const card=page.locator('.collection-card').filter({hasText:'Recovery customer'});
  const details=card.locator('.partial-collection-details');
  const form=card.locator('.partial-collection-form'),amount=form.locator('input[name="amount"]');
  const save=form.locator('button');
  await details.locator('summary').click();await amount.fill('30');holdReads=true;
  await save.evaluate(button=>{for(let i=0;i<20;i++)(button as HTMLButtonElement).click();});
  await expect.poll(()=>posts.length).toBe(1);
  await expect(save).toBeDisabled();await expect(amount).toBeDisabled();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,0);
  releasePost();
  await expect(details).not.toHaveAttribute('open','');
  await expect(amount).toHaveValue('');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,1);
  assert.equal(posts.length,1,'20 taps send only one request');
  await page.screenshot({path:'artifacts/partial-receipt-submit/confirmed-before-refresh.png'});
  holdReads=false;releaseReads();await expect(save).toBeEnabled();
  for(const [index,value] of ['30','20'].entries()){
    await details.locator('summary').click();await expect(amount).toHaveValue('');
    await amount.fill(value);await save.click();
    await expect.poll(()=>Number(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n)).toBe(index+2);
    await expect(details).not.toHaveAttribute('open','');await expect(save).toBeEnabled();
  }
  assert.equal(new Set(posts.map(post=>post.requestId)).size,3,'Each explicit new receipt has its own identity');
  assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n,100);
  for(const row of db.prepare('SELECT id FROM collection_submissions ORDER BY submitted_at,id').all())decideCollection(db,admin,String(row.id),{decision:'approve'},'test');
  assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n,20);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE entry_type='payment'").get()!.n,3);
  assert.deepEqual(errors,[]);
  console.log('PASS: 20 taps -> one POST/receipt; disable in flight; clear/close on confirmed reply before slow refresh; three intentional partials including equal amounts remain valid and reconcile after approval.');
}finally{
  releasePost();releaseReads();await browser.close();server.closeRealtimeConnections();server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();
}
