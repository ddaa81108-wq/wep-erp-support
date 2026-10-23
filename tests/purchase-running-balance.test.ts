import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { listPurchases } from '../src/server/domain/purchaseQueries.ts';
import { createPurchaseEntry, deletePurchaseEntry, updatePurchaseEntry } from '../src/server/domain/purchaseEntryCommands.ts';
import { finalizePurchaseDay, setPurchaseDayCorrection, setPurchaseOpening } from '../src/server/domain/purchaseDayCommands.ts';
import { purchasePreviewBalance, purchaseRunningBalances } from '../src/client/sections/purchases/purchaseRunningBalance.ts';

test('purchase running balance carries previous debt through purchases, standalone payments, correction, deletion and older pages',()=>{
  const db=openDatabase(':memory:');
  try {
    const actor=fixtureAdmin(db);
    let page=listPurchases(db,actor,'al_bayan',null,null);
    setPurchaseOpening(db,actor,'al_bayan',{expectedDayVersion:page.day.version,previousDebtUnits:1000,previousVodafoneUnits:0},'test');
    let request=0;
    const input=(value:number,paid:number)=>({requestId:`running-balance-${++request}`,expectedDayVersion:page.day.version,itemCode:'custom',itemLabel:'اختبار رصيد',egpValueUnits:value,calculationMode:'divide',exchangeRate:'1',paidUnits:paid,vodafoneConsumedUnits:0});
    const add=(value:number,paid:number)=>{
      page=listPurchases(db,actor,'al_bayan',null,null);
      createPurchaseEntry(db,actor,'al_bayan',input(value,paid),'test');
      page=listPurchases(db,actor,'al_bayan',null,null);
    };
    add(0,0);
    const firstDay=page.day.id;
    finalizePurchaseDay(db,actor,'al_bayan',{requestId:'running-finalize-day',expectedDayVersion:page.day.version},'test');
    page=listPurchases(db,actor,'al_bayan',null,null);
    assert.equal(page.day.previousDebtUnits,1000);
    assert.equal(page.day.totalDebtUnits,1000,'Empty new day retains its carried debt.');
    add(300,0);add(0,200);add(500,100);
    let balances=purchaseRunningBalances(page.entries,page.day.totalDebtUnits);
    assert.deepEqual(page.entries.map(entry=>balances.get(entry.id)?.after),[1000,1300,1100,1500]);
    assert.equal(balances.get(page.entries[1].id)?.before,1000);
    assert.equal(page.registerTotals.remainingUnits,1500);
    // A late page must keep its opening even when no previous rows are loaded.
    const suffix=page.entries.slice(-2);
    const partial=purchaseRunningBalances(suffix,page.day.totalDebtUnits);
    assert.deepEqual(suffix.map(entry=>partial.get(entry.id)),suffix.map(entry=>balances.get(entry.id)));
    const prefix=page.entries[0];
    setPurchaseDayCorrection(db,actor,'al_bayan',firstDay,{open:true,expectedVersion:prefix.dayVersion},'test');
    page=listPurchases(db,actor,'al_bayan',null,null);
    const original=page.entries[0];
    updatePurchaseEntry(db,actor,'al_bayan',original.id,{...input(100,0),expectedDayVersion:original.dayVersion,expectedVersion:original.version},'test');
    page=listPurchases(db,actor,'al_bayan',null,null);
    balances=purchaseRunningBalances(page.entries,page.day.totalDebtUnits);
    assert.equal(page.day.previousDebtUnits,1100);
    assert.deepEqual(page.entries.map(entry=>balances.get(entry.id)?.after),[1100,1400,1200,1600]);
    const payment=page.entries[2];
    deletePurchaseEntry(db,actor,'al_bayan',payment.id,{requestId:'running-delete-payment',expectedVersion:payment.version,expectedDayVersion:payment.dayVersion},'test');
    page=listPurchases(db,actor,'al_bayan',null,null);
    balances=purchaseRunningBalances(page.entries,page.day.totalDebtUnits);
    assert.deepEqual(page.entries.map(entry=>balances.get(entry.id)?.after),[1100,1400,1800]);
    assert.equal(balances.get(page.entries.at(-1)!.id)?.after,page.registerTotals.remainingUnits);
    const other=listPurchases(db,actor,'simsim',null,null);
    assert.equal(other.day.totalDebtUnits,0,'Each merchant is independent.');
  } finally {db.close();}
});

test('purchase running preview supports credit, zero and safe integer boundaries',()=>{
  assert.equal(purchasePreviewBalance(1000,-200),800);
  assert.equal(purchasePreviewBalance(200,-300),-100);
  assert.equal(purchasePreviewBalance(-100,100),0);
  assert.equal(purchasePreviewBalance(Number.MAX_SAFE_INTEGER,1),null);
  assert.equal(purchasePreviewBalance(null,100),null);
});
