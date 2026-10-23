import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { openDatabase, maintainOperationalData } from '../src/server/db/database.ts';
import { submitCollection, decideCollection, closeCollectionDay, markCollectionCashReceived, listCollections } from '../src/server/domain/collections.ts';
import { HttpError } from '../src/server/http/errors.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { readPendingCollections, writePendingCollections } from '../src/client/employee/collections/pendingCollectionRequests.ts';

const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;

test('three independent pending installments stay open, approve separately and replay without extra payments', () => {
  const {db,admin,collector,assignments,ids}=collectionFixture();
  try {
    const bodies=[30,30,40].map((amountUnits,i)=>({mode:'partial',amountUnits,requestId:`independent-installment-${i}`}));
    const receipts=bodies.map(body=>submitCollection(db,collector,assignments[0],body,'test'));
    db.prepare("UPDATE collection_submissions SET submitted_at='2026-10-01T12:00:00.000Z'").run();
    assert.deepEqual(listCollections(db,collector).submissions.map(row=>row.id),[...receipts].reverse().map(row=>row.id),'Equal timestamps retain insertion order for installment numbering.');
    assert.equal(new Set(receipts.map(r=>r.id)).size,3);
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,100);
    const card=listCollections(db,collector).assignments.find(a=>a.id===assignments[0])!;
    assert.equal(card.hasPending,1);
    assert.equal(card.hasPendingFull,0);
    assert.throws(()=>submitCollection(db,collector,assignments[0],{mode:'full',amountUnits:100,requestId:'overlapping-full-receipt'},'test'),code('PENDING_SUBMISSION_EXISTS'));
    for (const i of [2,0,1]) {
      decideCollection(db,admin,receipts[i].id,{decision:'approve'},'test');
      assert.equal(submitCollection(db,collector,assignments[0],bodies[i],'retry').id,receipts[i].id);
      assert.throws(()=>decideCollection(db,admin,receipts[i].id,{decision:'approve'},'test'),code('SUBMISSION_ALREADY_DECIDED'));
      markCollectionCashReceived(db,admin,receipts[i].id,'test');
    }
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,0);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE entry_type='payment'").get()!.n,3);
    const full=submitCollection(db,collector,assignments[1],{mode:'full',requestId:'exclusive-full-receipt'},'test');
    assert.equal(listCollections(db,collector).assignments.find(a=>a.id===assignments[1])!.hasPendingFull,1);
    assert.throws(()=>submitCollection(db,collector,assignments[1],{mode:'partial',amountUnits:10,requestId:'partial-after-full-key'},'test'),code('PENDING_SUBMISSION_EXISTS'));
    decideCollection(db,admin,full.id,{decision:'approve'},'test');
    markCollectionCashReceived(db,admin,full.id,'test');
    const batchId=String(db.prepare('SELECT batch_id FROM debt_assignments WHERE id=?').get(assignments[0])!.batch_id);
    closeCollectionDay(db,admin,{batchId,confirmed:true},'test');
    for(const [i,body] of bodies.entries()) assert.equal(submitCollection(db,collector,assignments[0],body,'retry-after-close').id,receipts[i].id);
  } finally {db.close();}
});

test('rejecting one installment keeps other pending installments visible and reviewable', () => {
  const {db,admin,collector,assignments,ids}=collectionFixture();
  try {
    const receipts=[10,20,30].map((amountUnits,i)=>submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits,requestId:`reject-one-installment-${i}`},'test'));
    decideCollection(db,admin,receipts[2].id,{decision:'reject'},'test');
    assert.equal(db.prepare('SELECT status FROM debt_assignments WHERE id=?').get(assignments[0])!.status,'active');
    assert.ok(listCollections(db,admin).assignments.some(a=>a.id===assignments[0]));
    assert.equal(listCollections(db,collector).submissions.filter(s=>s.status==='pending').length,2);
    decideCollection(db,admin,receipts[0].id,{decision:'approve'},'test');
    decideCollection(db,admin,receipts[1].id,{decision:'approve'},'test');
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,70);
    assert.equal(submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:10,requestId:'new-after-reviewed-installments'},'test').replayed,false);
  } finally {db.close();}
});

test('schema 50 upgrades pending receipts to independent installments without deleting data', () => {
  const root=mkdtempSync(join(tmpdir(),'collection-installment-upgrade-'));
  const path=join(root,'test.sqlite');
  const {db,collector,assignments}=collectionFixture(path);
  let closed=false;
  try {
    const body={mode:'partial',amountUnits:15,requestId:'pre-upgrade-pending-key'};
    const first=submitCollection(db,collector,assignments[0],body,'test');
    db.exec(`DROP INDEX idx_pending_collection_assignment;
      DROP INDEX uq_pending_full_collection_submission;
      CREATE UNIQUE INDEX uq_pending_collection_submission ON collection_submissions(assignment_id) WHERE status='pending';
      DELETE FROM schema_migrations WHERE version=51;`);
    db.close(); closed=true;
    const upgraded=openDatabase(path);
    try {
      assert.equal(submitCollection(upgraded,collector,assignments[0],body,'retry').id,first.id);
      const second=submitCollection(upgraded,collector,assignments[0],{...body,requestId:'post-upgrade-pending-key'},'test');
      assert.notEqual(second.id,first.id);
      assert.equal(upgraded.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,2);
      assert.equal(upgraded.prepare('SELECT MAX(version) version FROM schema_migrations').get()!.version,51);
    } finally {upgraded.close();}
  } finally {if(!closed)db.close();rmSync(root,{recursive:true,force:true});}
});

test('linked collections require stable keys, replay without side effects and reject changed business payload', () => {
  const {db,collector,other,assignments} = collectionFixture();
  try {
    for (const requestId of [undefined,'short',1,'x'.repeat(129)])
      assert.throws(() => submitCollection(db,collector,assignments[0],{mode:'partial',amountUnits:30,requestId},'test'),code('REQUEST_ID_REQUIRED'));
    const body = {mode:'partial',amountUnits:30,requestId:'collection-retry-0001'};
    const first = submitCollection(db,collector,assignments[0],body,'test');
    const counts = () => ['collection_submissions','audit_log','event_log','debt_transactions','idempotency_keys']
      .map(table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
    const before = counts();
    const replay = submitCollection(db,collector,assignments[0],{...body,checkDuplicate:true,allowDuplicate:true},'retry');
    assert.equal(first.replayed,false);
    assert.equal(replay.id,first.id);
    assert.equal(replay.replayed,true);
    assert.deepEqual(replay.eventSequences,[]);
    assert.deepEqual(counts(),before);
    for (const change of [{amountUnits:31},{mode:'full'},{mode:'full',amountUnits:100}])
      assert.throws(() => submitCollection(db,collector,assignments[0],{...body,...change},'test'),code('REQUEST_ID_REUSED'));
    assert.throws(() => submitCollection(db,collector,assignments[1],body,'test'),code('REQUEST_ID_REUSED'));
    const next = submitCollection(db,collector,assignments[0],{...body,requestId:'different-pending-key'},'test');
    assert.notEqual(next.id,first.id,'A distinct partial receipt is allowed while the first awaits review.');
    assert.throws(() => submitCollection(db,other,assignments[0],body,'test'),error => error instanceof HttpError && error.status===403);
    // Same literal key belongs to a different actor, and cannot expose the first response.
    const own = submitCollection(db,other,assignments[2],body,'test');
    assert.notEqual(own.id,first.id);
    assert.throws(() => submitCollection(db,{...collector,organizationId:'different-org'},assignments[0],body,'test'),error => error instanceof HttpError && error.status===404);
    db.prepare('UPDATE idempotency_keys SET request_fingerprint=NULL WHERE actor_user_id=? AND request_id=?').run(collector.id,body.requestId);
    assert.throws(() => submitCollection(db,collector,assignments[0],body,'test'),code('LEGACY_REQUEST_REVIEW_REQUIRED'));
  } finally { db.close(); }
});

test('full and rejected submissions replay original acknowledgements after decisions, cleanup, restart and maintenance', () => {
  const root = mkdtempSync(join(tmpdir(),'collection-replay-'));
  const path = join(root,'test.sqlite');
  const {db,admin,collector,ids,assignments} = collectionFixture(path);
  let closed = false;
  try {
    const full = {mode:'full',requestId:'full-original-no-amount'};
    const created = submitCollection(db,collector,assignments[0],full,'test');
    decideCollection(db,admin,created.id,{decision:'approve'},'test');
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,0);
    const retry = submitCollection(db,collector,assignments[0],full,'lost-reply');
    assert.equal(retry.id,created.id);
    assert.equal(retry.amountUnits,100);
    assert.equal(retry.status,'pending','Acknowledgement is a snapshot; GET collections supplies current status.');
    assert.throws(() => decideCollection(db,admin,created.id,{decision:'approve'},'test'),code('SUBMISSION_ALREADY_DECIDED'));
    const rejectedBody = {mode:'partial',amountUnits:20,requestId:'rejected-original-key'};
    const rejected = submitCollection(db,collector,assignments[1],rejectedBody,'test');
    decideCollection(db,admin,rejected.id,{decision:'reject'},'test');
    assert.equal(submitCollection(db,collector,assignments[1],rejectedBody,'test').id,rejected.id);
    markCollectionCashReceived(db,admin,created.id,'test');
    const batchId = String(db.prepare('SELECT batch_id FROM debt_assignments WHERE id=?').get(assignments[0])!.batch_id);
    closeCollectionDay(db,admin,{batchId,confirmed:true},'test');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,0);
    assert.equal(submitCollection(db,collector,assignments[0],full,'test').id,created.id);
    db.close(); closed=true;
    const reopened = openDatabase(path);
    try {
      maintainOperationalData(reopened);
      const replay = submitCollection(reopened,collector,assignments[0],full,'restarted');
      assert.equal(replay.id,created.id);
      assert.equal(replay.replayed,true);
      assert.equal(reopened.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,0);
      assert.equal(reopened.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE entry_type='payment'").get()!.n,1);
    } finally { reopened.close(); }
  } finally { if (!closed) db.close(); rmSync(root,{recursive:true,force:true}); }
});

test('failure to store replay acknowledgement rolls back submission, audit and events atomically', () => {
  const {db,collector,assignments} = collectionFixture();
  try {
    const count = () => ['collection_submissions','audit_log','event_log','idempotency_keys'].map(table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n);
    const before=count();
    db.exec("CREATE TRIGGER reject_collection_key BEFORE INSERT ON idempotency_keys WHEN NEW.scope LIKE 'collections:submissions:%' BEGIN SELECT RAISE(ABORT,'test key storage failure'); END");
    const body={mode:'partial',amountUnits:20,requestId:'rollback-submit-key'};
    assert.throws(() => submitCollection(db,collector,assignments[0],body,'test'),/test key storage failure/);
    assert.deepEqual(count(),before);
    db.exec('DROP TRIGGER reject_collection_key');
    assert.equal(submitCollection(db,collector,assignments[0],body,'test').replayed,false);
  } finally { db.close(); }
});

test('HTTP concurrent retries return one submission; permission and payload conflicts remain enforced', async () => {
  const {db,admin,collector,other,assignments,ids}=collectionFixture();
  const server=createApp(db,loadConfig({databasePath:':memory:',publicOrigin:'',secureCookie:false,internetRequired:false,pushPublicKey:'',pushPrivateKey:''}));
  try {
    await listen(server,'127.0.0.1',0);
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const session=createSession(db,collector.id,'1',12);
    const headers={'Content-Type':'application/json','X-Client-Api-Version':'1','X-CSRF-Token':session.csrfToken,cookie:`abdo_session=${session.token}`};
    const path=`${base}/api/collections/assignments/${assignments[0]}/submissions`;
    const body={mode:'partial',amountUnits:40,requestId:'concurrent-http-key'};
    const replies=await Promise.all(Array.from({length:6},()=>fetch(path,{method:'POST',headers,body:JSON.stringify(body)})));
    for (const reply of replies) assert.equal(reply.status,201);
    const payloads=await Promise.all(replies.map(reply=>reply.json()));
    assert.equal(new Set(payloads.map(p=>p.data.id)).size,1);
    assert.equal(payloads.filter(p=>!p.data.replayed).length,1);
    decideCollection(db,admin,payloads[0].data.id,{decision:'approve'},'test');
    const replay=await fetch(path,{method:'POST',headers,body:JSON.stringify(body)});
    assert.equal((await replay.json()).data.id,payloads[0].data.id);
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[0])!.balance,60);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_submissions').get()!.n,1);
    const changed=await fetch(path,{method:'POST',headers,body:JSON.stringify({...body,amountUnits:41})});
    assert.equal(changed.status,409);
    assert.equal((await changed.json()).error.code,'REQUEST_ID_REUSED');
    const racePath=`${base}/api/collections/assignments/${assignments[1]}/submissions`;
    const race=await Promise.all([20,21].map(amountUnits=>fetch(racePath,{method:'POST',headers,body:JSON.stringify({...body,amountUnits,requestId:'conflicting-http-key'})})));
    assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    const otherSession=createSession(db,other.id,'1',12);
    assert.equal((await fetch(path,{method:'POST',headers:{...headers,cookie:`abdo_session=${otherSession.token}`,'X-CSRF-Token':otherSession.csrfToken},body:JSON.stringify(body)})).status,403);
    db.prepare("UPDATE user_permissions SET allowed=0 WHERE user_id=? AND permission='collections.write'").run(collector.id);
    assert.equal((await fetch(path,{method:'POST',headers,body:JSON.stringify(body)})).status,403,'Replay must still require current permission.');
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    db.close();
  }
});

test('client journal preserves exact payload per user and rejects malformed storage', () => {
  const values=new Map<string,string>();
  const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
  const request={assignmentId:'assignment',requestId:'client-retry-key',mode:'partial' as const,amountUnits:25};
  writePendingCollections(storage,'employee-a',[request]);
  assert.deepEqual(readPendingCollections(storage,'employee-a'),[request]);
  assert.deepEqual(readPendingCollections(storage,'employee-b'),[]);
  writePendingCollections(storage,'employee-a',[]);
  assert.deepEqual(readPendingCollections(storage,'employee-a'),[]);
  assert.throws(()=>readPendingCollections({getItem:()=>'{broken'},'employee-a'));
  assert.throws(()=>readPendingCollections({getItem:()=>JSON.stringify([{...request,amountUnits:0}])},'employee-a'));
  assert.throws(()=>writePendingCollections({setItem:()=>{throw new Error('Storage disabled');}},'employee-a',[request]));
});
