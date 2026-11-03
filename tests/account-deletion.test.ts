import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import {
  createCustomer,
  customerSnapshot,
  listCustomers,
  addCustomerTransaction,
} from '../src/server/domain/customers.ts';
import { deleteCustomerAccount } from '../src/server/domain/customerDeletion.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';
import { collectionFixture } from './helpers/collectionFixture.ts';
import {
  submitCollection,
  decideCollection,
  markCollectionCashReceived,
} from '../src/server/domain/collections.ts';

test('system-linked accounts remain protected from manual deletion', () => {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  try {
    const linked = db
      .prepare(
        "SELECT id FROM customers WHERE section_key='egyptian_deposits' AND system_link_key IS NOT NULL LIMIT 1",
      )
      .get()!;
    assert.ok(linked);
    assert.throws(
      () =>
        deleteCustomerAccount(
          db,
          admin,
          String(linked.id),
          { requestId: 'delete-system-linked' },
          'test',
          'depositEgp',
        ),
      { code: 'SYSTEM_LINK_ACCOUNT_PROTECTED' },
    );
    assert.equal(db.prepare('SELECT deleted_at FROM customers WHERE id=?').get(linked.id)!.deleted_at, null);
  } finally {
    db.close();
  }
});

for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp'] as const)
  test(`admin deletes ${kind} from active views, retains evidence and can create a new file`, () => {
    const db = openDatabase(':memory:');
    const admin = fixtureAdmin(db);
    try {
      const created = createCustomer(
        db,
        admin,
        { name: 'حساب خاطئ ' + kind, openingBalance: 100, requestId: 'delete-create-' + kind },
        'test',
        kind,
      );
      const id = String((created.body.customer as { id: string }).id);
      const before = customerSnapshot(db, id, admin.organizationId, kind);
      const history = db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(id);
      const body = {
        requestId: 'delete-account-key',
        expectedVersion: before.version,
        confirmedName: before.name,
        confirmedBalanceUnits: 100,
        confirmed: true,
        reason: 'إنشاء ملف في القسم الصحيح',
      };
      const result = deleteCustomerAccount(db, admin, id, body, 'test', kind);
      assert.equal(result.body.deleted, true);
      assert.ok(db.prepare('SELECT deleted_at FROM customers WHERE id=?').get(id)!.deleted_at);
      assert.deepEqual(db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(id), history);
      assert.throws(() => customerSnapshot(db, id, admin.organizationId, kind), { status: 404 });
      assert.ok(
        !listCustomers(db, new URL('http://test/?filter=all'), admin.organizationId, kind).items.some(
          (row) => row.id === id,
        ),
      );
      assert.equal(deleteCustomerAccount(db, admin, id, body, 'retry', kind).replayed, true);
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_id=? AND action LIKE '%.delete'").get(id)!
          .n,
        1,
      );
      const replacement = createCustomer(
        db,
        admin,
        { name: before.name, openingBalance: 0, requestId: 'replacement-' + kind },
        'test',
        'customer',
      );
      assert.notEqual((replacement.body.customer as { id: string }).id, id);
      assert.equal((replacement.body.customer as { balanceUnits: number }).balanceUnits, 0);
      assert.equal(reconcileFinancials(db).issueCount, 0);
    } finally {
      db.close();
    }
  });

test('delete checks role, organization, account kind, exact confirmation and current version before changing anything', () => {
  const { db, admin, collector, ids } = collectionFixture();
  try {
    const account = customerSnapshot(db, ids[0], admin.organizationId);
    const body = {
      requestId: 'delete-validation',
      expectedVersion: account.version,
      confirmedName: account.name,
      confirmedBalanceUnits: 100,
      confirmed: true,
      reason: 'تصحيح ملف العميل',
    };
    assert.throws(() => deleteCustomerAccount(db, collector, ids[0], body, 'test', 'customer'), {
      status: 403,
    });
    assert.throws(
      () =>
        deleteCustomerAccount(db, { ...admin, organizationId: 'foreign' }, ids[0], body, 'test', 'customer'),
      { status: 404 },
    );
    assert.throws(() => deleteCustomerAccount(db, admin, ids[0], body, 'test', 'company'), { status: 404 });
    for (const wrong of [
      { confirmed: false },
      { confirmedName: 'اسم مختلف' },
      { confirmedBalanceUnits: 0 },
      { reason: '' },
    ])
      assert.throws(() =>
        deleteCustomerAccount(db, admin, ids[0], { ...body, ...wrong }, 'test', 'customer'),
      );
    addCustomerTransaction(
      db,
      admin,
      ids[0],
      { requestId: 'delete-race-write', expectedVersion: account.version, type: 'debt', inputValue: 10 },
      'test',
    );
    assert.throws(() => deleteCustomerAccount(db, admin, ids[0], body, 'test', 'customer'), {
      code: 'VERSION_CONFLICT',
    });
    assert.equal(customerSnapshot(db, ids[0], admin.organizationId).balanceUnits, 110);
  } finally {
    db.close();
  }
});

test('pending receipts and undelivered cash block deletion; settled history stays intact and audit failure rolls back', () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    const receipt = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 20, requestId: 'delete-pending' },
      'test',
    );
    const input = () => {
      const account = customerSnapshot(db, ids[0], admin.organizationId);
      return {
        requestId: 'delete-settled-key',
        expectedVersion: account.version,
        confirmedName: account.name,
        confirmedBalanceUnits: account.balanceUnits,
        confirmed: true,
        reason: 'تصحيح ملف مكرر',
      };
    };
    assert.throws(() => deleteCustomerAccount(db, admin, ids[0], input(), 'test', 'customer'), {
      code: 'ACCOUNT_HAS_UNSETTLED_COLLECTIONS',
    });
    decideCollection(db, admin, receipt.id, { decision: 'approve' }, 'test');
    assert.throws(() => deleteCustomerAccount(db, admin, ids[0], input(), 'test', 'customer'), {
      code: 'ACCOUNT_HAS_UNSETTLED_COLLECTIONS',
    });
    markCollectionCashReceived(db, admin, receipt.id, 'test');
    db.exec(
      "CREATE TRIGGER fail_account_delete BEFORE INSERT ON audit_log WHEN NEW.action='customer.delete' BEGIN SELECT RAISE(ABORT,'test audit failure'); END",
    );
    assert.throws(
      () => deleteCustomerAccount(db, admin, ids[0], input(), 'test', 'customer'),
      /test audit failure/,
    );
    assert.equal(customerSnapshot(db, ids[0], admin.organizationId).activeAssignmentId, assignments[0]);
    db.exec('DROP TRIGGER fail_account_delete');
    deleteCustomerAccount(db, admin, ids[0], input(), 'test', 'customer');
    assert.equal(
      db.prepare('SELECT status FROM debt_assignments WHERE id=?').get(assignments[0])!.status,
      'cancelled',
    );
    assert.equal(
      db.prepare('SELECT status FROM collection_submissions WHERE id=?').get(receipt.id)!.status,
      'approved',
    );
    assert.equal(
      db.prepare('SELECT collector_user_id FROM collection_submissions WHERE id=?').get(receipt.id)!
        .collector_user_id,
      collector.id,
    );
  } finally {
    db.close();
  }
});
