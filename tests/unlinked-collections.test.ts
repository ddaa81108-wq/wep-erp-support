import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { openDatabase, type AppDatabase } from '../src/server/db/database.ts';
import { createCustomer } from '../src/server/domain/customers.ts';
import {
  collectionLinkCandidates,
  createUnlinkedCollectionReceipt,
  decideUnlinkedCollectionReceipt,
  listCollections,
  markUnlinkedCollectionCashReceived,
} from '../src/server/domain/collections.ts';
import type { AuthenticatedUser } from '../src/server/security/sessions.ts';

const databases: AppDatabase[] = [];
afterEach(() => { while (databases.length) databases.pop()?.close(); });

function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const now = new Date().toISOString();
  const addUser = db.prepare(`INSERT INTO users(
    id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?)`);
  addUser.run('admin-unlinked', 'admin-unlinked', 'المدير', 'hash', 'admin', 'org-default', 'branch-main', now, now);
  addUser.run('employee-unlinked', 'employee-unlinked', 'الصغير', 'hash', 'employee', 'org-default', 'branch-main', now, now);
  const admin: AuthenticatedUser = {
    id:'admin-unlinked',username:'admin-unlinked',displayName:'المدير',role:'admin',organizationId:'org-default',
    homeBranchId:'branch-main',mustChangePassword:false,permissions:new Set(),sessionTokenHash:'',csrfHash:'',
  };
  const employee: AuthenticatedUser = {
    id:'employee-unlinked',username:'employee-unlinked',displayName:'الصغير',role:'employee',organizationId:'org-default',
    homeBranchId:'branch-main',mustChangePassword:false,permissions:new Set(['collections.read','collections.write']),sessionTokenHash:'',csrfHash:'',
  };
  return { db, admin, employee };
}

test('rejected unlinked receipts disappear for both roles without financial posting', () => {
  const { db, admin, employee } = setup();
  const receipt = createUnlinkedCollectionReceipt(db, employee, {
    requestId:'reject-unlinked-receipt',customerName:'استلام للاختبار',amountUnits:300,
  }, 'test');
  assert.throws(() => decideUnlinkedCollectionReceipt(db, employee, receipt.id, {decision:'reject'}, 'test'));
  const before = db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n;
  decideUnlinkedCollectionReceipt(db, admin, receipt.id, {decision:'reject'}, 'test');
  for (const actor of [admin, employee]) {
    const data = listCollections(db, actor);
    assert.equal(data.unlinkedReceipts.length, 0);
    assert.equal(data.metrics.unlinkedPendingCount, 0);
    assert.equal(data.metrics.collectedUnits, 0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, before);
  assert.equal(db.prepare('SELECT status FROM collection_unlinked_receipts WHERE id=?').get(receipt.id)!.status, 'rejected');
});

test('an unlinked employee receipt stays financially inert until administration links and approves it', () => {
  const { db, admin, employee } = setup();
  const created = createCustomer(db, admin, {
    requestId:'create-original-customer',name:'أحمد ورشة المعلم',openingBalance:1000,
  }, 'customer-correlation');
  const customerId = String((created.body.customer as {id:string}).id);

  const receipt = createUnlinkedCollectionReceipt(db, employee, {
    requestId:'unlinked-receipt-0001',customerName:'أحمد ورشة المعلم',amountUnits:300,
  }, 'receipt-correlation');
  const before = db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(customerId) as {balance:number};
  assert.equal(before.balance, 1000);
  const employeeDashboard = listCollections(db, employee);
  assert.equal(employeeDashboard.metrics.collectedUnits, 0);
  assert.equal(employeeDashboard.metrics.unlinkedPendingCount, 1);
  assert.equal(employeeDashboard.unlinkedReceipts[0] && (employeeDashboard.unlinkedReceipts[0] as {customerName:string}).customerName, 'أحمد ورشة المعلم');

  const candidates = collectionLinkCandidates(db, admin, 'أحمد ورشة');
  assert.equal((candidates.items[0] as {id:string}).id, customerId);
  decideUnlinkedCollectionReceipt(db, admin, String(receipt.id), {
    decision:'approve',customerId,entryType:'payment',
  }, 'approve-correlation');

  const after = db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(customerId) as {balance:number};
  assert.equal(after.balance, 700);
  const adminDashboard = listCollections(db, admin);
  assert.equal(adminDashboard.metrics.collectedUnits, 300);
  assert.equal(adminDashboard.metrics.unlinkedPendingCount, 0);
  assert.equal((adminDashboard.unlinkedReceipts[0] as {status:string}).status, 'approved');

  markUnlinkedCollectionCashReceived(db, admin, String(receipt.id), 'cash-correlation');
  const settled = listCollections(db, admin);
  assert.equal((settled.unlinkedReceipts[0] as {cashReceivedAt:string|null}).cashReceivedAt !== null, true);
});

test('administration can create a new customer or company directly from a pending receipt', () => {
  const { db, admin, employee } = setup();
  const receipt = createUnlinkedCollectionReceipt(db, employee, {
    requestId:'unlinked-new-company-0001',customerName:'شركة النور الجديدة',amountUnits:450,
  }, 'new-company-receipt');

  const before = listCollections(db, admin);
  assert.equal(before.metrics.unlinkedPendingCount, 1);
  assert.equal((before.unlinkedReceipts[0] as {customerName:string}).customerName, 'شركة النور الجديدة');

  decideUnlinkedCollectionReceipt(db, admin, String(receipt.id), {
    decision:'approve',newAccountKind:'company',entryType:'debt',
  }, 'new-company-approve');

  const company = db.prepare(`SELECT name,section_key AS sectionKey,current_balance_units AS balance
    FROM customers WHERE name='شركة النور الجديدة'`).get() as {
      name:string;sectionKey:string;balance:number;
    };
  assert.equal(company.sectionKey, 'company_debts');
  assert.equal(company.balance, 450);
  const after = listCollections(db, admin);
  assert.equal(after.metrics.unlinkedPendingCount, 0);
  assert.equal((after.unlinkedReceipts[0] as {status:string}).status, 'approved');
});
