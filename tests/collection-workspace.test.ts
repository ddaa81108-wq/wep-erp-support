import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionBoardFixture } from './helpers/collectionBoardFixture.ts';
import { collectionWorkspace } from '../src/server/domain/collectionWorkspaceQueries.ts';
import { listCollections } from '../src/server/domain/collections.ts';

test('workspace reads full financial scope beyond 200 rows; filters and duplicate staff names never mix totals', () => {
  const { db, admin, collector, other, batch, oldBatch, currentAssignments } = collectionBoardFixture();
  try {
    const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
    const query = (params: string) =>
      collectionWorkspace(
        db,
        admin,
        new URL('http://local/api/collections/workspace?batchId=' + batch.id + '&' + params),
      );
    const all = query('state=all');
    const summary = all.summary as {
      approvedUnits: number;
      receivedUnits: number;
      outstandingUnits: number;
      pendingCount: number;
      unlinkedPendingCount: number;
      receiptCount: number;
    };
    assert.ok(all.totalItems > 200);
    assert.equal(all.items.length, 60);
    assert.equal(summary.approvedUnits, summary.receivedUnits + summary.outstandingUnits);
    assert.equal(summary.unlinkedPendingCount, 10);
    assert.equal(query('state=cash').summary!.approvedUnits, summary.approvedUnits);
    assert.equal(query('state=review&q=not-found').summary!.approvedUnits, summary.approvedUnits);
    assert.equal(query('state=review&q=not-found').totalItems, 0);
    const first = query('state=all&employeeId=' + collector.id),
      second = query('state=all&employeeId=' + other.id);
    assert.ok(first.items.every((item) => item.collectorUserId === collector.id));
    assert.ok(second.items.every((item) => item.collectorUserId === other.id));
    assert.notEqual(first.summary!.approvedUnits, second.summary!.approvedUnits);
    const exported = query('state=all&export=1');
    assert.equal(
      exported.items.reduce((sum, item) => sum + Number(item.amountUnits), 0),
      summary.approvedUnits,
    );
    assert.ok(exported.items.length > 200);
    assert.equal(exported.hasMore, false);
    assert.equal(
      new Set(
        [...all.items, ...query('state=all&page=2').items].map((item) => String(item.kind) + String(item.id)),
      ).size,
      120,
    );
    assert.ok(query('state=all&assignmentId=' + currentAssignments[3]).items.length === 4);
    assert.equal(
      collectionWorkspace(db, admin, new URL('http://local/?batchId=' + oldBatch.id)).totalItems,
      0,
    );
    assert.equal(
      collectionWorkspace(
        db,
        { ...admin, organizationId: 'org-other' },
        new URL('http://local/?batchId=' + batch.id),
      ).totalItems,
      0,
    );
    assert.throws(() => collectionWorkspace(db, collector, new URL('http://local/?batchId=' + batch.id)));
    assert.throws(() => query('state=invalid'));
    assert.throws(() => query('state=all&page=-1'));
    assert.equal(listCollections(db, admin).outstandingCancelledSubmissions[0].collectorUserId, collector.id);
    assert.deepEqual(
      db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
      before,
    );
  } finally {
    db.close();
  }
});
