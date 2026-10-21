import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {join,resolve} from 'node:path';
import type {AddressInfo} from 'node:net';
import {chromium} from '@playwright/test';
import {createApp,listen} from '../src/server/app.ts';
import {openDatabase} from '../src/server/db/database.ts';
import type {ServerConfig} from '../src/server/config.ts';
import { MAIN_SECTIONS, SECTION_CONTRACTS } from '../src/shared/sections.ts';
const folder=mkdtempSync(join(tmpdir(),'erp-auth-l01-'));
const database=openDatabase(join(folder,'test.sqlite'));
const config:ServerConfig={host:'127.0.0.1',port:0,databasePath:':memory:',sessionHours:12,secureCookie:false,internetRequired:false,internetProbeUrls:[],internetProbeTimeoutMs:100,internetProbeCacheMs:100};
const server=createApp(database,config);
const browser=await chromium.launch();
try {
 await listen(server,'127.0.0.1',0);
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const page=await browser.newPage({viewport:{width:1672,height:941},bypassCSP:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const setup=await page.request.post(base+'/api/setup/admin',{data:{username:'admin',displayName:'اختبار البوابة',password:'Auth Preview 123!'}});assert.ok(setup.ok());
 await page.goto(base+'/erp');
 await page.getByLabel('البريد الإلكتروني',{exact:true}).fill('admin');
 await page.getByLabel('كلمة المرور',{exact:true}).fill('Auth Preview 123!');
 await page.getByRole('button',{name:'تسجيل الدخول',exact:true}).click();
 await page.locator('.app-shell').waitFor();assert.deepEqual(errors,[]);
 const output=resolve('artifacts/notification-position');mkdirSync(output,{recursive:true});
 for(const width of [1440,1100,900,390]) {
  await page.setViewportSize({width,height:950});

  for(const section of MAIN_SECTIONS) {
   if(width<=900) await page.getByRole('button',{name:'فتح القائمة الرئيسية',exact:true}).click();
   await page.locator('.sidebar').getByRole('button',{name:SECTION_CONTRACTS[section].title,exact:true}).click();
   await page.locator('.workspace.active-section-'+section).waitFor();
   const bell=page.getByRole('button',{name:'الإشعارات',exact:true});
   await bell.waitFor({state:'visible'});
   const position=await bell.evaluate(element=>{const b=element.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};});
   const originalSlot=await page.addStyleTag({content:'.utility-search-group{display:contents!important}.utility-search-group>.readability-control{display:none!important}'});
   const originalPosition=await bell.boundingBox();
   await originalSlot.evaluate(e=>e.parentNode?.removeChild(e));
   assert.ok(originalPosition && Math.abs(position.left-originalPosition.x)<=1,section+' at '+width+': notification moved from original slot');
   const reading=page.getByRole('button',{name:/تكبير القراءة/});
   const readingPosition=await reading.boundingBox();
   assert.ok(readingPosition && (readingPosition.x+readingPosition.width<=position.left || readingPosition.x>=position.right),section+': reading button overlaps notifications');
   assert.ok(position.left>=0 && position.right<=width,section+': notification outside viewport');
   await bell.click();
   await page.locator('.notification-panel').waitFor({state:'visible'});
   await bell.click();
   if(section==='customers'||section==='companies') await page.screenshot({path:join(output,section+'-'+width+'.png')});
  }
 }
 assert.deepEqual(errors,[]);
 console.log('PASS: original notification position retained, reading button separate, notifications open in 10 sections at 4 widths.');
}finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));database.close();rmSync(folder,{recursive:true,force:true});}




