import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectionFixture } from './helpers/collectionFixture.ts';
import {
  assignCustomers,
  cancelCollectionAssignment,
  decideCollection,
  listCollections,
  submitCollection,
} from '../src/server/domain/collections.ts';
import { addCustomerTransaction } from '../src/server/domain/customers.ts';
import { openDatabase } from '../src/server/db/database.ts';

test('assigned debt stays fixed after partial/full payment, rejection and later account activity', () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    const card = () => listCollections(db, collector).assignments.find((row) => row.id === assignments[0])!;
    assert.equal(card().assignedBalanceUnits, 100);
    const part = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 30, requestId: 'assigned-part' },
      'test',
    );
    decideCollection(db, admin, part.id, { decision: 'approve' }, 'test');
    assert.equal(card().balanceUnits, 70);
    assert.equal(card().assignedBalanceUnits, 100);
    const wrong = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 10, requestId: 'assigned-wrong' },
      'test',
    );
    decideCollection(db, admin, wrong.id, { decision: 'reject' }, 'test');
    assert.equal(card().assignedBalanceUnits, 100);
    const full = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'full', requestId: 'assigned-full' },
      'test',
    );
    decideCollection(db, admin, full.id, { decision: 'approve' }, 'test');
    assert.equal(card().balanceUnits, 0);
    assert.equal(card().assignedBalanceUnits, 100);
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(ids[0])!.version);
    addCustomerTransaction(
      db,
      admin,
      ids[0],
      { type: 'debt', inputValue: 20, requestId: 'assigned-later', expectedVersion: version },
      'test',
    );
    assert.equal(card().balanceUnits, 20);
    assert.equal(card().assignedBalanceUnits, 100);
    cancelCollectionAssignment(db, admin, assignments[0], 'test');
    const next = assignCustomers(db, admin, { customerIds: [ids[0]], assigneeUserId: collector.id }, 'test')
      .assignmentIds[0];
    assert.equal(
      listCollections(db, collector).assignments.find((row) => row.id === next)!.assignedBalanceUnits,
      20,
    );
  } finally {
    db.close();
  }
});

test('schema 53 upgrade preserves financial rows and restores only verifiable old assignment amounts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'collection-amount-'));
  const path = join(directory, 'legacy.sqlite');
  const { db, admin, collector, ids, assignments } = collectionFixture(path);
  try {
    db.prepare("UPDATE debt_transactions SET created_at='2026-01-01',updated_at='2026-01-01'").run();
    db.prepare("UPDATE customer_cycles SET created_at='2026-01-01'").run();
    db.prepare("UPDATE debt_assignments SET assigned_at='2026-01-02'").run();
    const full = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'full', requestId: 'legacy-assigned-full' },
      'test',
    );
    decideCollection(db, admin, full.id, { decision: 'approve' }, 'test');
    addCustomerTransaction(
      db,
      admin,
      ids[1],
      { type: 'debt', inputValue: 20, expectedVersion: 1, requestId: 'legacy-manual' },
      'test',
    );
    const before = db.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    db.exec(
      'ALTER TABLE debt_assignments DROP COLUMN assigned_balance_units; DELETE FROM schema_migrations WHERE version=54;',
    );
    db.close();
    const upgraded = openDatabase(path);
    try {
      assert.equal(
        upgraded
          .prepare('SELECT assigned_balance_units n FROM debt_assignments WHERE id=?')
          .get(assignments[0])!.n,
        100,
      );
      assert.equal(
        upgraded
          .prepare('SELECT assigned_balance_units n FROM debt_assignments WHERE id=?')
          .get(assignments[1])!.n,
        null,
      );
      assert.equal(
        upgraded
          .prepare('SELECT assigned_balance_units n FROM debt_assignments WHERE id=?')
          .get(assignments[2])!.n,
        100,
      );
      assert.deepEqual(upgraded.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), before);
      assert.equal(
        upgraded.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n,
        0,
      );
    } finally {
      upgraded.close();
    }
  } finally {
    try {
      db.close();
    } catch { /* The legacy connection was already closed before reopening. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});
