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
import { addCustomerTransaction, createCustomer, correctCustomerTransaction, cancelCustomerTransaction } from '../src/server/domain/customers.ts';
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
      'ALTER TABLE debt_assignments DROP COLUMN first_submission_balance_units; ALTER TABLE debt_assignments DROP COLUMN assigned_balance_units; DELETE FROM schema_migrations WHERE version>=54;',
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

for (const kind of ['customer', 'company'] as const) {
  test(`${kind}: assigned amount follows ledger edits until the first successful submission, then freezes`, () => {
    const { db, admin, collector } = collectionFixture();
    try {
      const created = createCustomer(db, admin, { name: 'تحديث قيمة التوجيه', openingBalance: 100, requestId: 'live-assigned-' + kind }, 'test', kind);
      const id = String((created.body.customer as { id: string }).id);
      const assignment = assignCustomers(db, admin, { customerIds: [id], assigneeUserId: collector.id, section: kind === 'company' ? 'companies' : 'customers' }, 'test').assignmentIds[0];
      const version = () => Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version);
      const card = () => listCollections(db, collector).assignments.find(item => item.id === assignment)!;
      const assertAmount = (assigned: number, balance: number) => {
        for (const actor of [admin, collector]) {
          const found = listCollections(db, actor).assignments.find(item => item.id === assignment)!;
          assert.equal(found.assignedBalanceUnits, assigned);
          assert.equal(found.balanceUnits, balance);
        }
      };
      const debt = addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 200, expectedVersion: version(), requestId: 'live-assigned-debt' }, 'test', kind);
      const transactionId = String((debt.body.transaction as { id: string }).id);
      assertAmount(300, 300);
      correctCustomerTransaction(db, admin, id, transactionId, { type: 'debt', inputValue: 150, expectedVersion: version(), reason: 'تصحيح اختبار', requestId: 'live-assigned-correct' }, 'test', kind);
      assertAmount(250, 250);
      cancelCustomerTransaction(db, admin, id, transactionId, { expectedVersion: version(), reason: 'إلغاء اختبار', requestId: 'live-assigned-cancel' }, 'test', kind);
      assertAmount(100, 100);
      addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 1200, expectedVersion: version(), requestId: 'live-assigned-new-debt' }, 'test', kind);
      assertAmount(1300, 1300);
      assert.throws(() => submitCollection(db, collector, assignment, { mode: 'full', amountUnits: 100, requestId: 'live-assigned-invalid' }, 'test'), /بالضبط/);
      assert.equal(db.prepare('SELECT first_submission_balance_units n FROM debt_assignments WHERE id=?').get(assignment)!.n, null);
      const input = { mode: 'partial', amountUnits: 300, requestId: 'live-assigned-first' };
      const first = submitCollection(db, collector, assignment, input, 'test');
      assertAmount(1300, 1300);
      addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 50, expectedVersion: version(), requestId: 'live-assigned-after-submit' }, 'test', kind);
      assertAmount(1300, 1350);
      assert.equal(submitCollection(db, collector, assignment, input, 'retry').id, first.id);
      decideCollection(db, admin, first.id, { decision: 'approve' }, 'test');
      assertAmount(1300, 1050);
      const second = submitCollection(db, collector, assignment, { mode: 'partial', amountUnits: 50, requestId: 'live-assigned-second' }, 'test');
      decideCollection(db, admin, second.id, { decision: 'reject' }, 'test');
      assertAmount(1300, 1050);
      const third = submitCollection(db, collector, assignment, { mode: 'partial', amountUnits: 150, requestId: 'live-assigned-third' }, 'test');
      decideCollection(db, admin, third.id, { decision: 'approve' }, 'test');
      assertAmount(1300, 900);
      const full = submitCollection(db, collector, assignment, { mode: 'full', requestId: 'live-assigned-final' }, 'test');
      decideCollection(db, admin, full.id, { decision: 'approve' }, 'test');
      assertAmount(1300, 0);
      assert.equal(card().status, 'active');
    } finally { db.close(); }
  });
}

test('first submission freezes zero and negative current balances without altering partial-payment rules', () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    for (const [index, payment] of [100, 125].entries()) {
      addCustomerTransaction(db, admin, ids[index], { type: 'payment', inputValue: payment, expectedVersion: 1, requestId: 'assigned-zero-negative-' + index }, 'test');
      const balance = 100 - payment;
      assert.equal(listCollections(db, collector).assignments.find(row => row.id === assignments[index])!.assignedBalanceUnits, balance);
      submitCollection(db, collector, assignments[index], { mode: 'partial', amountUnits: 1, requestId: 'assigned-zero-negative-submit-' + index }, 'test');
      addCustomerTransaction(db, admin, ids[index], { type: 'debt', inputValue: 40, expectedVersion: 2, requestId: 'assigned-zero-negative-later-' + index }, 'test');
      assert.equal(listCollections(db, collector).assignments.find(row => row.id === assignments[index])!.assignedBalanceUnits, balance);
    }
  } finally { db.close(); }
});

test('schema 54 upgrade preserves historical submitted amounts and exposes live unsubmitted balances', () => {
  const directory = mkdtempSync(join(tmpdir(), 'collection-first-balance-'));
  const path = join(directory, 'schema54.sqlite');
  const { db, admin, collector, ids, assignments } = collectionFixture(path);
  try {
    addCustomerTransaction(db, admin, ids[0], { type: 'debt', inputValue: 50, expectedVersion: 1, requestId: 'historical-submitted-debt' }, 'test');
    submitCollection(db, collector, assignments[0], { mode: 'partial', amountUnits: 10, requestId: 'historical-submitted' }, 'test');
    addCustomerTransaction(db, admin, ids[1], { type: 'debt', inputValue: 25, expectedVersion: 1, requestId: 'historical-unsubmitted' }, 'test');
    const financialRows = db.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    db.exec('ALTER TABLE debt_assignments DROP COLUMN first_submission_balance_units; DELETE FROM schema_migrations WHERE version>=55;');
    db.close();
    const reopened = openDatabase(path);
    try {
      assert.equal(listCollections(reopened, collector).assignments.find(row => row.id === assignments[0])!.assignedBalanceUnits, 100);
      assert.equal(listCollections(reopened, collector).assignments.find(row => row.id === assignments[1])!.assignedBalanceUnits, 125);
      assert.deepEqual(reopened.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), financialRows);
    } finally { reopened.close(); }
  } finally {
    try { db.close(); } catch { /* Closed for the upgrade test. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});
