import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionFixture } from './helpers/collectionFixture.ts';
import {
  assignCustomers,
  cancelCollectionAssignment,
  submitCollection,
  decideCollection,
  listCollections,
  markCollectionCashReceived,
} from '../src/server/domain/collections.ts';
import { customerSnapshot as getCustomer } from '../src/server/domain/customers.ts';

test('admin can remove a zero-balance assignment without losing approved cash or financial history', () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    const receipt = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'full', requestId: 'unassign-full' },
      'test',
    );
    decideCollection(db, admin, receipt.id, { decision: 'approve' }, 'test');
    const before = getCustomer(db, ids[0], admin.organizationId);
    assert.equal(before.balanceUnits, 0);
    assert.equal(before.activeAssignmentId, assignments[0]);
    const transactions = db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(ids[0]);
    cancelCollectionAssignment(db, admin, assignments[0], 'test');
    const after = getCustomer(db, ids[0], admin.organizationId);
    assert.equal(after.activeAssignmentId, null);
    assert.equal(after.activeAssigneeName, null);
    assert.equal(after.balanceUnits, before.balanceUnits);
    assert.equal(after.version, before.version);
    assert.deepEqual(
      db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(ids[0]),
      transactions,
    );
    const outstanding = listCollections(db, admin).outstandingCancelledSubmissions;
    assert.ok(outstanding.some((row) => row.id === receipt.id));
    markCollectionCashReceived(db, admin, receipt.id, 'test');
    assert.ok(
      db.prepare('SELECT cash_received_at FROM collection_submissions WHERE id=?').get(receipt.id)!
        .cash_received_at,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='collection.unassign'").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});

test('unassignment preserves pending receipts and their collector; a late retry never removes a new assignment', () => {
  const { db, admin, collector, other, ids, assignments } = collectionFixture();
  try {
    const receipt = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 20, requestId: 'unassign-pending' },
      'test',
    );
    cancelCollectionAssignment(db, admin, assignments[0], 'test');
    assert.throws(() =>
      submitCollection(
        db,
        collector,
        assignments[0],
        { mode: 'partial', amountUnits: 10, requestId: 'after-unassign' },
        'test',
      ),
    );
    const next = assignCustomers(db, admin, { customerIds: [ids[0]], assigneeUserId: other.id }, 'test')
      .assignmentIds[0];
    const replay = cancelCollectionAssignment(db, admin, assignments[0], 'retry');
    assert.deepEqual(replay.eventSequences, []);
    assert.equal(getCustomer(db, ids[0], admin.organizationId).activeAssignmentId, next);
    decideCollection(db, admin, receipt.id, { decision: 'approve' }, 'test');
    const row = db
      .prepare('SELECT status,collector_user_id,cash_received_at FROM collection_submissions WHERE id=?')
      .get(receipt.id)!;
    assert.equal(row.status, 'approved');
    assert.equal(row.collector_user_id, collector.id);
    assert.equal(row.cash_received_at, null);
    assert.equal(getCustomer(db, ids[0], admin.organizationId).balanceUnits, 80);
    assert.equal(getCustomer(db, ids[0], admin.organizationId).activeAssignmentId, next);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='collection.unassign'").get()!.n,
      1,
    );
  } finally {
    db.close();
  }
});

test('unassignment is restricted to the administrator and organization', () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    assert.throws(() => cancelCollectionAssignment(db, collector, assignments[0], 'test'), { status: 403 });
    assert.throws(
      () =>
        cancelCollectionAssignment(db, { ...admin, organizationId: 'different-org' }, assignments[0], 'test'),
      { status: 404 },
    );
    assert.equal(getCustomer(db, ids[0], admin.organizationId).activeAssignmentId, assignments[0]);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='collection.unassign'").get()!.n,
      0,
    );
  } finally {
    db.close();
  }
});
