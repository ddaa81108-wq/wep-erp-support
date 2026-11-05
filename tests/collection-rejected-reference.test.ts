import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { addCustomerTransaction, createCustomer } from '../src/server/domain/customers.ts';
import { assignCustomers, submitCollection, decideCollection, listCollections } from '../src/server/domain/collections.ts';
import { cancelCollectionApproval } from '../src/server/domain/collectionApprovalCancellation.ts';
import { openDatabase } from '../src/server/db/database.ts';

for (const kind of ['customer', 'company'] as const) test(`${kind}: rejected unpaid receipt releases reference and positive card stays ahead of zeros`, () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    let id = ids[0], assignment = assignments[0];
    if (kind === 'company') {
      const created = createCustomer(db, admin, { name: 'شركة اختبار رفض', openingBalance: 100, requestId: 'reject-reference-company' }, 'test', 'company');
      id = String((created.body.customer as { id: string }).id);
      assignment = assignCustomers(db, admin, { customerIds: [id], assigneeUserId: collector.id, section: 'companies' }, 'test').assignmentIds[0];
    }
    const version = () => Number(db.prepare('SELECT version FROM customers WHERE id=?').get(id)!.version);
    const amount = () => listCollections(db, collector).assignments.find(row => row.id === assignment)!.assignedBalanceUnits;
    const firstInput = { mode: 'full', requestId: 'reject-reference-first' };
    const first = submitCollection(db, collector, assignment, firstInput, 'test');
    addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 1000, expectedVersion: version(), requestId: 'reject-reference-add' }, 'test', kind);
    assert.equal(amount(), 100);
    decideCollection(db, admin, first.id, { decision: 'reject' }, 'test');
    assert.equal(amount(), 1100);
    assert.equal(db.prepare('SELECT first_submission_balance_units n FROM debt_assignments WHERE id=?').get(assignment)!.n, null);
    addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 1, expectedVersion: version(), requestId: 'reject-reference-add-one' }, 'test', kind);
    assert.equal(amount(), 1101);
    // A replay of the old rejected receipt cannot re-freeze or create another receipt.
    assert.equal(submitCollection(db, collector, assignment, firstInput, 'retry').id, first.id);
    assert.equal(amount(), 1101);
    addCustomerTransaction(db, admin, ids[1], { type: 'payment', inputValue: 100, expectedVersion: 1, requestId: 'reject-reference-zero' }, 'test');
    for (const actor of [admin, collector]) {
      const cards = listCollections(db, actor).assignments;
      assert.ok(cards.findIndex(row => row.id === assignment) < cards.findIndex(row => row.id === assignments[1]));
      assert.equal(cards.find(row => row.id === assignment)!.latestStatus, 'rejected');
    }
    const next = submitCollection(db, collector, assignment, { mode: 'full', requestId: 'reject-reference-next' }, 'test');
    assert.equal(next.amountUnits, 1101);
    assert.equal(amount(), 1101);
    addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 20, expectedVersion: version(), requestId: 'reject-reference-later' }, 'test', kind);
    assert.equal(amount(), 1101);
    decideCollection(db, admin, next.id, { decision: 'approve' }, 'test');
    assert.equal(amount(), 1101);
    assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(id)!.n, 20);
  } finally { db.close(); }
});

test('remaining pending/approved partial receipts preserve their reference; rejecting/cancelling the last one releases it', () => {
  const { db, admin, collector, ids, assignments } = collectionFixture();
  try {
    const id = ids[0], assignment = assignments[0];
    const amount = () => listCollections(db, collector).assignments.find(row => row.id === assignment)!.assignedBalanceUnits;
    const first = submitCollection(db, collector, assignment, { mode: 'partial', amountUnits: 20, requestId: 'reject-multiple-first' }, 'test');
    addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 50, expectedVersion: 1, requestId: 'reject-multiple-add' }, 'test');
    const second = submitCollection(db, collector, assignment, { mode: 'partial', amountUnits: 10, requestId: 'reject-multiple-second' }, 'test');
    decideCollection(db, admin, first.id, { decision: 'reject' }, 'test');
    assert.equal(amount(), 100);
    decideCollection(db, admin, second.id, { decision: 'reject' }, 'test');
    assert.equal(amount(), 150);
    const third = submitCollection(db, collector, assignment, { mode: 'partial', amountUnits: 50, requestId: 'reject-multiple-third' }, 'test');
    const posted = decideCollection(db, admin, third.id, { decision: 'approve' }, 'test');
    const fourth = submitCollection(db, collector, assignment, { mode: 'partial', amountUnits: 5, requestId: 'reject-multiple-fourth' }, 'test');
    decideCollection(db, admin, fourth.id, { decision: 'reject' }, 'test');
    assert.equal(amount(), 150);
    cancelCollectionApproval(db, admin, third.id, { requestId: 'reject-multiple-cancel', reason: 'تصحيح اختبار الإلغاء', expectedTransactionId: posted.transactionId }, 'test');
    addCustomerTransaction(db, admin, id, { type: 'debt', inputValue: 20, expectedVersion: 4, requestId: 'reject-multiple-new-debt' }, 'test');
    assert.equal(amount(), 170);
  } finally { db.close(); }
});

test('schema55 repair uses recorded submit evidence, preserves financial rows and does not rebase overlapping partials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rejected-collection-reference-'));
  const path = join(directory, 'schema55.sqlite');
  const { db, admin, collector, ids, assignments } = collectionFixture(path);
  try {
    const first = submitCollection(db, collector, assignments[0], { mode: 'full', requestId: 'repair-old-first' }, 'test');
    decideCollection(db, admin, first.id, { decision: 'reject' }, 'test');
    addCustomerTransaction(db, admin, ids[0], { type: 'debt', inputValue: 1001, expectedVersion: 1, requestId: 'repair-new-debt' }, 'test');
    submitCollection(db, collector, assignments[0], { mode: 'full', requestId: 'repair-new-full' }, 'test');
    db.prepare('UPDATE debt_assignments SET first_submission_balance_units=100 WHERE id=?').run(assignments[0]);
    const overlapFirst = submitCollection(db, collector, assignments[1], { mode: 'partial', amountUnits: 10, requestId: 'repair-overlap-first' }, 'test');
    addCustomerTransaction(db, admin, ids[1], { type: 'debt', inputValue: 50, expectedVersion: 1, requestId: 'repair-overlap-debt' }, 'test');
    const overlapSecond = submitCollection(db, collector, assignments[1], { mode: 'partial', amountUnits: 20, requestId: 'repair-overlap-second' }, 'test');
    decideCollection(db, admin, overlapFirst.id, { decision: 'reject' }, 'test');
    db.prepare('UPDATE collection_submissions SET submitted_at=?,decided_at=? WHERE id=?').run('2026-01-01T12:00:00Z','2026-01-01T12:02:00Z',overlapFirst.id);
    db.prepare('UPDATE collection_submissions SET submitted_at=? WHERE id=?').run('2026-01-01T12:01:00Z',overlapSecond.id);
    const unknownFirst = submitCollection(db, admin, assignments[2], { mode: 'full', requestId: 'repair-unknown-first' }, 'test');
    decideCollection(db, admin, unknownFirst.id, { decision: 'reject' }, 'test');
    addCustomerTransaction(db, admin, ids[2], { type: 'debt', inputValue: 55, expectedVersion: 1, requestId: 'repair-unknown-debt' }, 'test');
    const unknownNext = submitCollection(db, admin, assignments[2], { mode: 'full', requestId: 'repair-unknown-next' }, 'test');
    db.prepare('UPDATE debt_assignments SET first_submission_balance_units=100 WHERE id=?').run(assignments[2]);
    db.prepare("UPDATE audit_log SET details_json=json_remove(details_json,'$.balanceAtSubmissionUnits') WHERE action='collection.submit' AND entity_id=?").run(unknownNext.id);
    const snapshots = ['debt_transactions','collection_submissions','audit_log'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    db.exec('DELETE FROM schema_migrations WHERE version=56'); db.close();
    const reopened = openDatabase(path);
    try {
      assert.equal(reopened.prepare('SELECT first_submission_balance_units n FROM debt_assignments WHERE id=?').get(assignments[0])!.n, 1101);
      assert.equal(reopened.prepare('SELECT first_submission_balance_units n FROM debt_assignments WHERE id=?').get(assignments[1])!.n, 100);
      assert.equal(reopened.prepare('SELECT first_submission_balance_units n FROM debt_assignments WHERE id=?').get(assignments[2])!.n, 100, 'Missing historical evidence is never invented.');
      assert.deepEqual(['debt_transactions','collection_submissions','audit_log'].map(table => reopened.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()), snapshots);
    } finally { reopened.close(); }
  } finally {
    try { db.close(); } catch { /* Closed for upgrade. */ }
    rmSync(directory, { recursive: true, force: true });
  }
});
