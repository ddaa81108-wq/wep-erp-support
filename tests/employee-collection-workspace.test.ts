import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionBoardFixture } from './helpers/collectionBoardFixture.ts';
import {
  employeeCollectionWorkspace,
  collectionWorkspace,
} from '../src/server/domain/collectionWorkspaceQueries.ts';
import { submitCollection } from '../src/server/domain/collections.ts';

test('employee receipt pagination binds identity and organization and cannot reveal other collectors or use admin export', () => {
  const { db, collector, other, admin, currentAssignments } = collectionBoardFixture();
  try {
    for (let i = 1; i <= 220; i++)
      submitCollection(
        db,
        collector,
        currentAssignments[0],
        { mode: 'partial', amountUnits: i, requestId: 'employee-many-' + i },
        'test',
      );
    const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
    const read = (params: string) =>
      employeeCollectionWorkspace(db, collector, new URL('http://local/?state=all&' + params));
    const first = read('employeeId=' + other.id + '&export=1');
    assert.ok(first.totalItems > 200);
    assert.equal(first.items.length, 60);
    assert.equal(first.hasMore, true);
    assert.ok(first.items.every((item) => item.collectorUserId === collector.id));
    assert.deepEqual(
      first.employees.map((item) => item.id),
      [collector.id],
    );
    assert.equal(read('assignmentId=' + currentAssignments[1]).totalItems, 0);
    assert.deepEqual(read('q=missing').summary, first.summary);
    assert.equal(new Set([...first.items, ...read('page=2').items].map((item) => String(item.id))).size, 120);
    assert.equal(
      employeeCollectionWorkspace(
        db,
        { ...collector, organizationId: 'foreign' },
        new URL('http://local/?state=all'),
      ).totalItems,
      0,
    );
    assert.throws(() =>
      employeeCollectionWorkspace(db, { ...collector, permissions: new Set() }, new URL('http://local/')),
    );
    assert.throws(() => employeeCollectionWorkspace(db, admin, new URL('http://local/')));
    assert.throws(() => collectionWorkspace(db, collector, new URL('http://local/')));
    assert.deepEqual(
      db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(),
      before,
    );
  } finally {
    db.close();
  }
});
