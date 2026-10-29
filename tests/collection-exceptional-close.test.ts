import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { submitCollection, decideCollection, createUnlinkedCollectionReceipt, decideUnlinkedCollectionReceipt,
  closeCollectionDay, listCollections, markCollectionCashReceived, markUnlinkedCollectionCashReceived, assignCustomers } from '../src/server/domain/collections.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';
import { HttpError } from '../src/server/http/errors.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';

const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;

test('exceptional closure removes work cards, preserves linked/unlinked cash and allows later receipt without financial reposting', () => {
  const { db, admin, collector, other, assignments, ids } = collectionFixture();
  try {
    const linked = submitCollection(db, collector, assignments[0], { mode:'partial',amountUnits:40,requestId:'exception-linked' }, 'test');
    decideCollection(db, admin, linked.id, {decision:'approve'}, 'test');
    const received = submitCollection(db, collector, assignments[1], {mode:'partial',amountUnits:20,requestId:'exception-received'}, 'test');
    decideCollection(db, admin, received.id, {decision:'approve'}, 'test');
    markCollectionCashReceived(db, admin, received.id, 'test');
    const unlinked = createUnlinkedCollectionReceipt(db, collector, {customerName:'Unlinked cash',amountUnits:30,requestId:'exception-unlinked'}, 'test');
    decideUnlinkedCollectionReceipt(db, admin, unlinked.id, {decision:'approve',customerId:ids[1],entryType:'payment'}, 'test');
    const batch = listCollections(db, admin).openBatches[0] as Record<string,unknown>;
    assert.equal(batch.cashPendingCount,2);
    assert.equal(batch.cashPendingUnits,70);
    const normal={batchId:batch.id,confirmed:true};
    const exception={...normal,allowOutstandingCash:true,reason:'الموظف سيسلم الباقي غدًا',expectedCashPendingCount:2,expectedCashPendingUnits:70};
    assert.throws(()=>closeCollectionDay(db,admin,normal,'test'),code('COLLECTION_DAY_NOT_SETTLED'));
    assert.throws(()=>closeCollectionDay(db,admin,{...exception,reason:''},'test'),code('EXCEPTION_REASON_REQUIRED'));
    assert.throws(()=>closeCollectionDay(db,admin,{...exception,expectedCashPendingUnits:60},'test'),code('COLLECTION_CASH_CHANGED'));
    const financial=()=>({ledger:db.prepare('SELECT * FROM debt_transactions ORDER BY id').all(),customers:db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all()});
    const before=financial();
    const closed=closeCollectionDay(db,admin,exception,'test');
    assert.equal('archived' in closed && closed.archived,true);
    assert.equal('deletedSubmissions' in closed && closed.deletedSubmissions,0);
    assert.deepEqual(financial(),before);
    const data=listCollections(db,admin);
    assert.equal(data.assignments.length,0);
    assert.equal(data.openBatches.length,0);
    assert.equal(data.submissions.length,0);
    assert.equal(data.unlinkedReceipts.length,0);
    assert.equal(data.metrics.collectedUnits,0);
    assert.equal(data.metrics.executedCount,0);
    assert.equal(data.metrics.cashOutstandingUnits,70);
    assert.equal(data.outstandingCancelledSubmissions.length,1);
    assert.equal(data.outstandingClosedUnlinkedReceipts.length,1);
    assert.equal(data.employeeTotals?.find(item=>item.employeeId===collector.id)?.collectedUnits,0);
    assert.equal(listCollections(db,other).outstandingCancelledSubmissions.length,0);
    assert.equal(listCollections(db,other).outstandingClosedUnlinkedReceipts.length,0);
    assert.equal(listCollections(db,collector).metrics.cashOutstandingUnits,70);
    const audit=JSON.parse(String(db.prepare("SELECT details_json FROM audit_log WHERE action='collection.batch.close'").get()!.details_json));
    assert.equal(audit.exceptional,true); assert.equal(audit.reason,exception.reason); assert.equal(audit.cashPendingUnits,70);
    assert.equal(closeCollectionDay(db,admin,exception,'retry').replayed,true);
    assert.equal(reconcileFinancials(db).status,'matched');
    // The same customer can start fresh work while old cash remains independently due.
    const reassigned=assignCustomers(db,admin,{customerIds:[ids[0]],assigneeUserId:collector.id},'test');
    assert.equal(reassigned.assignmentIds.length,1);
    assert.equal(listCollections(db,admin).metrics.cashOutstandingUnits,70);
    markCollectionCashReceived(db,admin,linked.id,'test');
    assert.equal(listCollections(db,admin).metrics.cashOutstandingUnits,30);
    markUnlinkedCollectionCashReceived(db,admin,unlinked.id,'test');
    markUnlinkedCollectionCashReceived(db,admin,unlinked.id,'retry');
    assert.equal(listCollections(db,admin).metrics.cashOutstandingUnits,0);
    assert.equal(listCollections(db,admin).outstandingClosedUnlinkedReceipts.length,0);
    assert.deepEqual(financial(),before);
    assert.equal(reconcileFinancials(db).status,'matched');
  } finally { db.close(); }
});

test('pending approvals cannot be bypassed and changed cash requires a fresh confirmation', () => {
  const {db,admin,collector,assignments}=collectionFixture();
  try {
    const receipt=submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:10,requestId:'exception-pending'},'test');
    const batchId=listCollections(db,admin).openBatches[0].id;
    const input={batchId,confirmed:true,allowOutstandingCash:true,reason:'إغلاق استثنائي للاختبار',expectedCashPendingCount:0,expectedCashPendingUnits:0};
    assert.throws(()=>closeCollectionDay(db,admin,input,'test'),code('COLLECTION_DAY_NOT_SETTLED'));
    decideCollection(db,admin,receipt.id,{decision:'approve'},'test');
    assert.throws(()=>closeCollectionDay(db,admin,input,'test'),code('COLLECTION_CASH_CHANGED'));
    markCollectionCashReceived(db,admin,receipt.id,'test');
    assert.throws(()=>closeCollectionDay(db,admin,{...input,expectedCashPendingCount:1,expectedCashPendingUnits:10},'test'),code('COLLECTION_CASH_CHANGED'));
    assert.equal(db.prepare('SELECT status FROM collection_batches WHERE id=?').get(batchId)!.status,'open');
    closeCollectionDay(db,admin,{batchId,confirmed:true},'test');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,0);
  } finally {db.close();}
});

test('exceptional close is admin-only over HTTP and tenant scoped', async () => {
  const {db,admin,collector,assignments}=collectionFixture();
  const server=createApp(db,loadConfig({databasePath:':memory:',internetRequired:false}));
  try {
    await listen(server,'127.0.0.1',0);
    const receipt=submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:10,requestId:'exception-http'},'test');
    decideCollection(db,admin,receipt.id,{decision:'approve'},'test');
    const batchId=listCollections(db,admin).openBatches[0].id;
    const body={batchId,confirmed:true,allowOutstandingCash:true,reason:'إغلاق موثق للاختبار',expectedCashPendingCount:1,expectedCashPendingUnits:10};
    assert.throws(()=>closeCollectionDay(db,{...admin,organizationId:'another-org'},body,'test'),code('NOT_FOUND'));
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post=async(id:string)=>{
      const session=createSession(db,id,'1',12);
      return fetch(base+'/api/collections/days/close',{method:'POST',headers:{'Content-Type':'application/json','X-Client-Api-Version':'1','X-CSRF-Token':session.csrfToken,Cookie:`abdo_session=${session.token}`},body:JSON.stringify(body)});
    };
    const forbidden=await post(collector.id); assert.equal(forbidden.status,403); await forbidden.json();
    const success=await post(admin.id); assert.equal(success.status,200); await success.json();
    assert.equal(listCollections(db,collector).metrics.cashOutstandingUnits,10);
  } finally {server.closeRealtimeConnections();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));db.close();}
});

test('audit failure rolls back exceptional closure atomically', () => {
  const {db,admin,collector,assignments}=collectionFixture();
  try {
    const receipt=submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:10,requestId:'exception-rollback'},'test');
    decideCollection(db,admin,receipt.id,{decision:'approve'},'test');
    const batchId=listCollections(db,admin).openBatches[0].id;
    db.exec("CREATE TRIGGER fail_close BEFORE INSERT ON audit_log WHEN NEW.action='collection.batch.close' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(()=>closeCollectionDay(db,admin,{batchId,confirmed:true,allowOutstandingCash:true,reason:'إغلاق استثنائي للاختبار',expectedCashPendingCount:1,expectedCashPendingUnits:10},'test'));
    assert.equal(listCollections(db,admin).assignments.length,3);
    assert.equal(db.prepare('SELECT status FROM collection_batches WHERE id=?').get(batchId)!.status,'open');
    assert.equal(db.prepare('SELECT cash_received_at FROM collection_submissions WHERE id=?').get(receipt.id)!.cash_received_at,null);
    assert.equal(reconcileFinancials(db).status,'matched');
  } finally {db.close();}
});
