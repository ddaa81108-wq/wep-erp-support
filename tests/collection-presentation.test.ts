import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectionCardTone, compareCollectionCards, type CollectionCardState } from '../src/shared/collectionCardState.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { collectionRejectionMigrations } from '../src/server/db/migrationsCollectionRejection.ts';
import { createCustomer, addCustomerTransaction } from '../src/server/domain/customers.ts';
import { assignCustomers, submitCollection, decideCollection, markCollectionCashReceived, listCollections } from '../src/server/domain/collections.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const card = (id: string, changes: Partial<CollectionCardState> = {}): CollectionCardState => ({
  id, assignedAt: '2026-01-01T08:00:00.000Z', externalFinancialUpdatedAt: '2026-01-01T08:00:00.000Z',
  balanceUnits: 100, latestMode: null, latestStatus: null, latestSubmissionAt: null,
  latestCashReceivedAt: null, hasPending: 0, cashOutstandingCount: 0, ...changes,
});

test('collection colours distinguish zero, cash delivery, partial, credit, and rejected without role differences', () => {
  const partial = card('partial', { latestMode: 'partial', latestStatus: 'approved', latestSubmissionAt: '2026-01-02T08:00:00.000Z' });
  assert.equal(collectionCardTone(card('new')), 'collection-base');
  assert.equal(collectionCardTone(partial), 'collection-yellow');
  assert.equal(collectionCardTone({ ...partial, latestCashReceivedAt: '2026-01-03' }), 'collection-yellow');
  assert.equal(collectionCardTone({ ...partial, balanceUnits: 0 }), 'zero-collection-card');
  assert.equal(collectionCardTone({ ...partial, balanceUnits: 0, latestCashReceivedAt: '2026-01-03' }), 'collection-red');
  assert.equal(collectionCardTone({ ...partial, balanceUnits: 0, latestCashReceivedAt: '2026-01-03', cashOutstandingCount: 1 }), 'zero-collection-card');
  assert.equal(collectionCardTone({ ...partial, balanceUnits: -10 }), 'collection-green');
  assert.equal(collectionCardTone({ ...partial, latestStatus: 'rejected' }), 'collection-rejected');
  assert.equal(collectionCardTone({ ...partial, latestStatus: 'rejected', externalFinancialUpdatedAt:'2026-01-03', latestDecisionAt:'2026-01-04' }), 'collection-rejected');
  assert.equal(collectionCardTone({ ...partial, balanceUnits:0, latestCashReceivedAt:'2026-01-03', externalFinancialUpdatedAt:'2026-01-04' }), 'zero-collection-card');
});

test('new assignments and administrative financial changes lead; employee payments and cash do not promote cards', () => {
  const partial = card('partial', { latestMode: 'partial', latestSubmissionAt: '2026-01-02', latestStatus: 'approved' });
  const zero = card('zero', { balanceUnits: 0 });
  const rejected = card('rejected', { latestStatus: 'rejected', latestSubmissionAt: '2026-01-02' });
  const fresh = card('new', { assignedAt: '2026-01-02T08:00:00.000Z' });
  const credit = card('credit', { balanceUnits: -5 });
  const sorted = (cards: CollectionCardState[]) => [...cards].sort(compareCollectionCards).map(c => c.id);
  assert.deepEqual(sorted([zero, partial, rejected, credit, fresh]), ['new', 'partial', 'credit', 'zero', 'rejected']);
  assert.deepEqual(sorted([zero, {...partial, latestSubmissionAt: '2026-01-04', latestCashReceivedAt:'2026-01-05'}, rejected, credit, fresh]), ['new', 'partial', 'credit', 'zero', 'rejected']);
  assert.deepEqual(sorted([zero, {...partial, externalFinancialUpdatedAt:'2026-01-06'}, rejected, credit, fresh]), ['partial', 'new', 'credit', 'zero', 'rejected']);
  assert.equal(sorted([{...zero, externalFinancialUpdatedAt:'2026-01-07'},fresh])[0], 'zero');
});

test('collection API ordering tracks financial origin and preserves approval and employee scope', () => {
  const db = openDatabase(':memory:');
  try {
    const user = (id: string, role: 'admin' | 'employee'): AuthenticatedUser => ({
      id,username:id,displayName:id,role,organizationId:'org-default',homeBranchId:'branch-main',
      mustChangePassword:false,permissions:new Set(['collections.read','collections.write']),sessionTokenHash:'',csrfHash:'',
    });
    const admin=user('admin','admin'), employee=user('collector','employee'), other=user('other','employee');
    for (const u of [admin,employee,other]) {
      db.prepare('INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(u.id,u.username,u.displayName,'hash',u.role,u.organizationId,u.homeBranchId,'2000-01-01','2000-01-01');
      db.prepare("INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,'collections.write',1,'2000-01-01')").run(u.id);
    }
    const ids: string[]=[];
    for (const name of ['أول أبجديًا','آخر أبجديًا']) {
      const result=createCustomer(db,admin,{requestId:`create-collection-${ids.length}`,name,openingBalance:100},'test');
      ids.push(String((result.body.customer as {id:string}).id));
    }
    const assignmentIds=ids.map(id=>assignCustomers(db,admin,{customerIds:[id],assigneeUserId:employee.id},'test').assignmentIds[0]);
    db.prepare("UPDATE debt_transactions SET created_at='2000-01-01',updated_at='2000-01-01'").run();
    assignmentIds.forEach((id,i)=>db.prepare('UPDATE debt_assignments SET assigned_at=? WHERE id=?').run(`2001-01-0${i+1}`,id));
    const list=(actor=admin)=>listCollections(db,actor).assignments;
    assert.deepEqual(list().map(c=>c.id),[assignmentIds[1],assignmentIds[0]]);
    assert.deepEqual(list(employee).map(c=>c.id),list().map(c=>c.id));
    assert.equal(list(other).length,0);
    const partial=submitCollection(db,employee,assignmentIds[0],{mode:'partial',amountUnits:30},'test');
    assert.equal(list().find(c=>c.id===assignmentIds[0])!.balanceUnits,100,'pending receipts must not change posted balances');
    decideCollection(db,admin,partial.id,{decision:'approve'},'test');
    let current=list().find(c=>c.id===assignmentIds[0])!;
    assert.equal(current.balanceUnits,70);
    assert.equal(current.externalFinancialUpdatedAt,'2001-01-01','approval is employee collection, not manual promotion');
    markCollectionCashReceived(db,admin,partial.id,'test');
    assert.equal(collectionCardTone(list().find(c=>c.id===assignmentIds[0])!), 'collection-yellow');
    const full=submitCollection(db,employee,assignmentIds[0],{mode:'full',amountUnits:70},'test');
    decideCollection(db,admin,full.id,{decision:'approve'},'test');
    assert.equal(collectionCardTone(list().find(c=>c.id===assignmentIds[0])!), 'zero-collection-card');
    markCollectionCashReceived(db,admin,full.id,'test');
    assert.equal(collectionCardTone(list().find(c=>c.id===assignmentIds[0])!), 'collection-red');
    const reject=submitCollection(db,employee,assignmentIds[1],{mode:'partial',amountUnits:10},'test');
    decideCollection(db,admin,reject.id,{decision:'reject'},'test');
    assert.ok(!list().some(c => c.id === assignmentIds[1]));
    assert.ok(!list(employee).some(c => c.id === assignmentIds[1]));
    assert.equal(listCollections(db, admin).assignedCount, 1);
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[1])!.balance, 100);
    assert.equal(db.prepare('SELECT status FROM collection_submissions WHERE id=?').get(reject.id)!.status, 'rejected');
    assert.throws(() => submitCollection(db, employee, assignmentIds[1], {mode:'partial',amountUnits:10}, 'test'), /غير نشط/);
    const reassigned = assignCustomers(db, admin, { customerIds:[ids[1]], assigneeUserId:employee.id }, 'test').assignmentIds[0];
    const approved = submitCollection(db, employee, reassigned, {mode:'partial',amountUnits:20}, 'test');
    decideCollection(db, admin, approved.id, {decision:'approve'}, 'test');
    const refusedAgain = submitCollection(db, employee, reassigned, {mode:'partial',amountUnits:5}, 'test');
    assert.throws(() => decideCollection(db, employee, refusedAgain.id, {decision:'reject'}, 'test'));
    decideCollection(db, admin, refusedAgain.id, {decision:'reject'}, 'test');
    const outstanding = listCollections(db, admin).outstandingCancelledSubmissions;
    assert.deepEqual(outstanding.map(row => row.id), [approved.id]);
    assert.equal(outstanding[0].amountUnits, 20);
    assert.equal(listCollections(db, other).outstandingCancelledSubmissions.length, 0);
    assert.equal(listCollections(db, employee).outstandingCancelledSubmissions.length, 1);
    // Older rejected cards are cancelled without deleting any financial history.
    db.prepare("UPDATE debt_assignments SET status='active',cancelled_at=NULL WHERE id=?").run(reassigned);
    const before = db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n;
    db.exec(collectionRejectionMigrations[0].sql);
    assert.equal(db.prepare('SELECT status FROM debt_assignments WHERE id=?').get(reassigned)!.status, 'cancelled');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, before);
    assert.equal(db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[1])!.balance, 80);
    markCollectionCashReceived(db, admin, approved.id, 'test');
    assert.equal(listCollections(db, admin).outstandingCancelledSubmissions.length, 0);
    db.prepare("UPDATE collection_submissions SET submitted_at='2002-01-01'").run();
    current=list().find(c=>c.id===assignmentIds[0])!;
    addCustomerTransaction(db,admin,ids[0],{requestId:'admin-promote-collection',expectedVersion:Number(current.customerVersion),type:'debt',inputValue:50,calculationMode:'direct'},'test');
    assert.equal(list()[0].id,assignmentIds[0]);
    assert.equal(collectionCardTone(list()[0]),'collection-base');
    assert.deepEqual(list(employee).map(c=>c.id),list().map(c=>c.id));
  } finally { db.close(); }
});
