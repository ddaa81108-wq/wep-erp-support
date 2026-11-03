import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { createCustomer, customerSnapshot } from '../src/server/domain/customers.ts';
import {
  assignCustomers,
  cancelCollectionAssignment,
  decideCollection,
  listCollections,
  submitCollection,
} from '../src/server/domain/collections.ts';

for (const kind of ['customer', 'company'] as const) {
  test(`rejecting the last pending ${kind} receipt preserves assignment, earlier payments and cash; corrected submission needs no reassignment`, () => {
    const { db, admin, collector } = collectionFixture();
    try {
      const created = createCustomer(
        db,
        admin,
        { name: 'الجمهورية اختبار ' + kind, openingBalance: 100, requestId: 'reject-party-' + kind },
        'test',
        kind,
      );
      const id = String((created.body.customer as { id: string }).id);
      const assignmentId = assignCustomers(
        db,
        admin,
        {
          customerIds: [id],
          assigneeUserId: collector.id,
          section: kind === 'company' ? 'companies' : 'customers',
        },
        'test',
      ).assignmentIds[0];
      const original = submitCollection(
        db,
        collector,
        assignmentId,
        { mode: 'partial', amountUnits: 20, requestId: 'earlier-approved' },
        'test',
      );
      decideCollection(db, admin, original.id, { decision: 'approve' }, 'test');
      const mistakenInput = { mode: 'full', amountUnits: 80, requestId: 'mistaken-full' };
      const mistaken = submitCollection(db, collector, assignmentId, mistakenInput, 'test');
      const before = customerSnapshot(db, id, admin.organizationId, kind);
      const transactions = db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(id);
      const assignment = db.prepare('SELECT * FROM debt_assignments WHERE id=?').get(assignmentId);
      const result = decideCollection(
        db,
        admin,
        mistaken.id,
        { decision: 'reject', note: 'خطأ في تسجيل التسديد' },
        'test',
      );
      assert.deepEqual(customerSnapshot(db, id, admin.organizationId, kind), before);
      assert.deepEqual(
        db.prepare('SELECT * FROM debt_transactions WHERE customer_id=?').all(id),
        transactions,
      );
      assert.deepEqual(db.prepare('SELECT * FROM debt_assignments WHERE id=?').get(assignmentId), assignment);
      assert.equal(
        db.prepare('SELECT status FROM collection_submissions WHERE id=?').get(mistaken.id)!.status,
        'rejected',
      );
      assert.equal(result.eventSequences.length, 1);
      assert.equal(
        db.prepare('SELECT topic FROM event_log WHERE sequence=?').get(result.eventSequences[0])!.topic,
        'collection.changed',
      );
      for (const actor of [admin, collector]) {
        const data = listCollections(db, actor);
        const card = data.assignments.find((row) => row.id === assignmentId)!;
        assert.ok(card);
        assert.equal(card.balanceUnits, 80);
        assert.equal(card.hasPending, 0);
        assert.equal(card.hasPendingFull, 0);
        assert.equal(data.metrics.cashOutstandingUnits, 20);
      }
      assert.equal(submitCollection(db, collector, assignmentId, mistakenInput, 'retry').id, mistaken.id);
      const corrected = submitCollection(
        db,
        collector,
        assignmentId,
        { mode: 'partial', amountUnits: 30, requestId: 'corrected-receipt' },
        'test',
      );
      decideCollection(db, admin, corrected.id, { decision: 'approve' }, 'test');
      assert.equal(customerSnapshot(db, id, admin.organizationId, kind).balanceUnits, 50);
      assert.equal(customerSnapshot(db, id, admin.organizationId, kind).activeAssignmentId, assignmentId);
      assert.equal(listCollections(db, collector).metrics.cashOutstandingUnits, 50);
    } finally {
      db.close();
    }
  });
}

test('rejecting a receipt never reactivates an assignment explicitly removed by administration', () => {
  const { db, admin, collector, assignments } = collectionFixture();
  try {
    const receipt = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 10, requestId: 'removed-pending' },
      'test',
    );
    cancelCollectionAssignment(db, admin, assignments[0], 'test');
    decideCollection(db, admin, receipt.id, { decision: 'reject' }, 'test');
    assert.equal(
      db.prepare('SELECT status FROM debt_assignments WHERE id=?').get(assignments[0])!.status,
      'cancelled',
    );
    assert.ok(!listCollections(db, collector).assignments.some((row) => row.id === assignments[0]));
  } finally {
    db.close();
  }
});
