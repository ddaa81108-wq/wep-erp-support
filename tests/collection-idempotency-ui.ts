import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { chromium, expect, type Browser } from '@playwright/test';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { decideCollection } from '../src/server/domain/collections.ts';
import { pendingCollectionKey } from '../src/client/employee/collections/pendingCollectionRequests.ts';

const {db,collector,admin,ids}=collectionFixture();
const server=createApp(db,loadConfig({databasePath:':memory:',publicOrigin:'',secureCookie:false,internetRequired:false,pushPublicKey:'',pushPrivateKey:''}));
let browser: Browser | undefined;
try {
  await listen(server,'127.0.0.1',0);
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const session=createSession(db,collector.id,'1',12);
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext();
  await context.addCookies([{name:'abdo_session',value:session.token,url:base,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept());
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const requests:Record<string,unknown>[]=[];
  let dropReply=true;
  await page.route('**/api/collections/assignments/*/submissions',async route=>{
    requests.push(route.request().postDataJSON());
    const response=await route.fetch(); // The real isolated server commits before the reply is discarded.
    if (dropReply) {
      assert.equal(response.status(),201);
      dropReply=false;
      await route.abort('failed');
    } else await route.fulfill({response});
  });
  const open=async()=>{
    await page.goto(base+'/erp');
    await page.getByRole('button',{name:'قسم استلامات الديون',exact:true}).click();
    await expect(page.locator('.employee-collections-page')).toBeVisible();
  };
  await open();
  const card=page.locator('.collection-card').filter({hasText:'Recovery customer'});
  await card.locator('summary').click();
  await card.locator('input[name="amount"]').fill('30');
  await card.getByRole('button',{name:'حفظ',exact:true}).click();
  const recovery=page.locator('.pending-collection-recovery');
  await expect(recovery).toBeVisible();
  await expect.poll(()=>requests.length).toBe(1);
  const key=pendingCollectionKey(collector.id);
  const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key);
  assert.equal(stored[0].requestId,requests[0].requestId);
  const submitted=db.prepare('SELECT id FROM collection_submissions').get() as {id:string};
  decideCollection(db,admin,submitted.id,{decision:'approve'},'test-lost-response');
  // Reload loses component state. The journal must survive, with no automatic second POST.
  await open();
  await expect(recovery).toBeVisible();
  assert.equal(requests.length,1);
  const currentCard=page.locator('.collection-card').filter({hasText:'Recovery customer'});
  await currentCard.locator('summary').click();
  await currentCard.locator('input[name="amount"]').fill('31');
  await currentCard.locator('input[name="amount"]').press('Enter');
  await expect(page.getByText('توجد محاولة سابقة لم يتأكد ردها. أعد التحقق منها قبل تغيير المبلغ أو نوع التحصيل.',{exact:true})).toBeVisible();
  assert.equal(requests.length,1,'A changed amount must not replace the uncertain request.');
  // Even a permission error during recovery must not erase a potentially committed request.
  db.prepare("UPDATE user_permissions SET allowed=0 WHERE user_id=? AND permission='collections.write'").run(collector.id);
  await recovery.getByRole('button').click();
  await expect.poll(()=>requests.length).toBe(2);
  await expect(recovery.getByRole('button')).toBeEnabled();
  assert.equal((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key)).length,1);
  db.prepare("UPDATE user_permissions SET allowed=1 WHERE user_id=? AND permission='collections.write'").run(collector.id);
  await recovery.getByRole('button').click();
  await expect(recovery).toHaveCount(0);
  assert.equal(requests.length,3);
  assert.deepEqual(requests[1],requests[0]);
  assert.deepEqual(requests[2],requests[0]);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key),[]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,1);
  assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,70);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE entry_type='payment'").get()!.n,1);
  // Disabled persistent storage must prevent sending a fresh operation.
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw new Error('Test: storage unavailable');};});
  const second=page.locator('.collection-card').filter({hasText:'Second customer'});
  await second.getByRole('button',{name:'استلام كلي',exact:true}).click();
  await expect(page.getByText('تعذر حفظ مفتاح الطلب على هذا الجهاز. لم يتم إرسال تحصيل جديد.',{exact:true})).toBeVisible();
  assert.equal(requests.length,3);
  assert.deepEqual(errors,[]);
  const mobile=await context.newPage();
  await mobile.goto(base+'/erp');
  await mobile.evaluate(()=>localStorage.setItem('abdo-readability','large'));
  await mobile.reload();
  await mobile.getByRole('button',{name:'قسم استلامات الديون',exact:true}).click();
  await mobile.setViewportSize({width:390,height:844});
  const mobileCard=mobile.locator('.collection-card').filter({hasText:'Second customer'});
  await mobileCard.locator('summary').click();
  const mobileAmount=mobileCard.locator('input[name="amount"]');
  await mobileAmount.fill('25');
  const focusedBox=await mobileAmount.boundingBox();
  const save=mobileCard.getByRole('button',{name:'حفظ',exact:true});
  await save.focus();
  assert.equal((await mobileAmount.boundingBox())?.height,focusedBox?.height,'Magnification must preserve input geometry.');
  await mobileAmount.focus();
  await save.click();
  await expect(mobileCard).toContainText('ينتظر الاعتماد');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,2);
  await expect(mobileCard.getByRole('button',{name:'استلام كلي',exact:true})).toBeDisabled();
  for (const [index,amount] of ['20','15'].entries()) {
    await mobileAmount.fill(amount);
    await save.click();
    await expect.poll(()=>Number(db.prepare("SELECT COUNT(*) n FROM collection_submissions WHERE customer_id=? AND status='pending'").get(ids[1])!.n)).toBe(index+2);
    await expect(save).toBeEnabled();
    await expect(mobile.locator('.pending-collection-recovery')).toHaveCount(0);
  }
  assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[1])!.balance,100);
  const adminContext=await browser.newContext();
  const adminSession=createSession(db,admin.id,'1',12);
  await adminContext.addCookies([{name:'abdo_session',value:adminSession.token,url:base,httpOnly:true,sameSite:'Strict'}]);
  const adminPage=await adminContext.newPage();
  await adminPage.goto(base+'/erp');
  await adminPage.getByRole('button',{name:'قسم استلامات الديون',exact:true}).click();
  const adminCard=adminPage.locator('.admin-customer-collection-card').filter({hasText:'Second customer'});
  await expect(adminCard.locator('.admin-card-history > article')).toHaveCount(3);
  for (const remaining of [2,1,0]) {
    await adminCard.getByRole('button',{name:'اعتماد',exact:true}).first().click();
    await expect(adminCard.getByRole('button',{name:'اعتماد',exact:true})).toHaveCount(remaining);
  }
  assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[1])!.balance,40);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE entry_type='payment'").get()!.n,4);
  console.log('PASS: safe recovery after a lost reply; three independent mobile installments before review; three separate admin approvals and exact balances.');
} finally {
  await browser?.close();
  server.closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise<void>(resolve=>server.close(()=>resolve()));
  db.close();
}
