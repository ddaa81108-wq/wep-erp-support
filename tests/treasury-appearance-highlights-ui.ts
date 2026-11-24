import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';
import { cockpitPreviewFixture } from './helpers/cockpitPreviewFixture.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
const {db,admin}=cockpitPreviewFixture();
const before=db.prepare('SELECT * FROM treasury_cash_entries ORDER BY id').all();
const server=createApp(db,loadConfig({databasePath:':memory:',publicOrigin:'',secureCookie:false,internetRequired:false,pushPublicKey:'',pushPrivateKey:''}));
const browser=await chromium.launch();
try {
 await listen(server,'127.0.0.1',0);
 const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const context=await browser.newContext({viewport:{width:1600,height:1080},reducedMotion:'reduce'});
 await context.addCookies([{name:'abdo_session',value:createSession(db,admin.id,'test',12).token,url:base}]);
 const page=await context.newPage();const errors:string[]=[],writes:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url());});
 await page.goto(base+'/erp');
 await page.locator('.sidebar nav').getByRole('button',{name:'الخزينة',exact:true}).click();
 await expect(page.locator('.treasury-card.active-cash')).toBeVisible();
 const values=await page.locator('.treasury-cards').textContent();
 mkdirSync('artifacts/treasury-highlights',{recursive:true});
 for(const appearance of ['03','cockpit']) {
  await page.setViewportSize({width:1600,height:1080});
  const toggle=page.getByRole('button',{name:'تبديل تنسيق الأشرطة',exact:true});
  while(await toggle.getAttribute('data-appearance')!==appearance) await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-royal-shell',appearance);
  for(const theme of ['light','dark']) for(const width of [1600,390]) {
   await page.setViewportSize({width,height:1080});
   await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
   await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
   const colors=await page.locator('.treasury-movement-badge').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.textContent,{color:getComputedStyle(n).color,bg:getComputedStyle(n).backgroundColor}])));
   assert.ok(colors['دخول']);assert.ok(colors['خروج']);assert.notDeepEqual(colors['دخول'],colors['خروج']);
   assert.equal(await page.locator('.treasury-card.active-cash b').evaluate(n=>getComputedStyle(n).color),'rgb(255, 255, 255)');
   assert.equal(await page.locator('.treasury-cards').textContent(),values);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
   await page.screenshot({path:`artifacts/treasury-highlights/${appearance}-${theme}-${width}.png`,fullPage:true});
  }
 }
 assert.deepEqual(db.prepare('SELECT * FROM treasury_cash_entries ORDER BY id').all(),before);
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 console.log('PASS: both appearances, light/dark, desktop/phone; distinct direction badges, highlighted cash, unchanged totals, no financial writes.');
} finally {await browser.close();server.closeRealtimeConnections();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));db.close();}
