import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium, expect } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { submitCollection, decideCollection, createUnlinkedCollectionReceipt, decideUnlinkedCollectionReceipt } from '../src/server/domain/collections.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';

const {db,admin,collector,assignments,ids}=collectionFixture();
const server=createApp(db,loadConfig({databasePath:':memory:',internetRequired:false}));
const browser=await chromium.launch({headless:true});
const errors:string[]=[];
try {
  await listen(server,'127.0.0.1',0);
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const linked=submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:40,requestId:'ui-exception-linked'},'test');
  decideCollection(db,admin,linked.id,{decision:'approve'},'test');
  const unlinked=createUnlinkedCollectionReceipt(db,collector,{customerName:'UI unlinked receipt',amountUnits:30,requestId:'ui-exception-unlinked'},'test');
  decideUnlinkedCollectionReceipt(db,admin,unlinked.id,{decision:'approve',customerId:ids[1],entryType:'payment'},'test');
  const open=async(userId:string)=>{
    const context=await browser.newContext({viewport:{width:1440,height:950}});
    const session=createSession(db,userId,'1',12);
    await context.addCookies([{name:'abdo_session',value:session.token,url:base,httpOnly:true,sameSite:'Strict'}]);
    const page=await context.newPage(); page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/erp');
    await page.getByRole('button',{name:'قسم استلامات الديون',exact:true}).click();
    return page;
  };
  const adminPage=await open(admin.id), employeePage=await open(collector.id);
  await expect(employeePage.getByRole('button',{name:'إغلاق ومسح الدفعة',exact:true})).toHaveCount(0);
  await adminPage.locator('.collection-desktop-batch-actions').getByRole('button',{name:'إغلاق ومسح الدفعة',exact:true}).click();
  const dialog=adminPage.getByRole('dialog');
  await expect(dialog).toContainText('70');
  await expect(dialog.getByRole('button',{name:'نعم، امسح الدفعة',exact:true})).toBeDisabled();
  const checkbox=dialog.getByRole('checkbox',{name:'إغلاق استثنائي مع بقاء النقدية مستحقة',exact:true});
  await checkbox.check();
  const confirm=dialog.getByRole('button',{name:'نعم، أغلق استثنائيًا',exact:true});
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('سبب الإغلاق الاستثنائي',{exact:true}).fill('سيتم استلام النقدية المتبقية غدًا');
  // Change the server snapshot without publishing; the stale confirmation must fail.
  const extra=submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:10,requestId:'ui-exception-race'},'test');
  decideCollection(db,admin,extra.id,{decision:'approve'},'test');
  await confirm.click();
  await expect(dialog.getByRole('alert')).toContainText('تغيّرت النقدية');
  await expect(checkbox).not.toBeChecked();
  await expect(dialog).toContainText('80');
  await checkbox.check();
  await adminPage.setViewportSize({width:390,height:844});
  await expect.poll(()=>adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  mkdirSync(resolve('artifacts/exceptional-close'),{recursive:true});
  await adminPage.screenshot({path:resolve('artifacts/exceptional-close/confirmation-phone.png'),animations:'disabled'});
  const before=db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(adminPage.locator('.admin-customer-collection-card')).toHaveCount(0);
  const adminCash=adminPage.getByRole('region',{name:'نقدية سابقة لم تُسلّم',exact:true});
  await expect(adminCash.locator('.outstanding-cash-row')).toHaveCount(3);
  const employeeCash=employeePage.getByRole('region',{name:'نقدية سابقة لم تُسلّم',exact:true});
  await expect(employeeCash.locator('.outstanding-cash-row')).toHaveCount(3);
  await expect(employeeCash.getByRole('button')).toHaveCount(0);
  for(let remaining=3;remaining>0;remaining--){
    await adminCash.getByRole('button',{name:'تم استلام النقدية',exact:true}).first().click();
    await expect(adminPage.locator('.outstanding-cash-row')).toHaveCount(remaining-1);
  }
  await expect(employeePage.locator('.outstanding-cash-row')).toHaveCount(0);
  assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),before);
  assert.equal(reconcileFinancials(db).status,'matched');
  assert.deepEqual(errors,[]);
  console.log('PASS exceptional closure: admin-only, stale confirmation rejected, phone confirmation, linked/unlinked cash retained and received later without financial reposting.');
}finally{
  await browser.close();server.closeRealtimeConnections();server.closeAllConnections();
  await new Promise<void>(done=>server.close(()=>done()));db.close();
}
