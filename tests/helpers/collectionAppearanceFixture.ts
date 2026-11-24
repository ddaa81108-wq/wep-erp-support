import assert from 'node:assert/strict';
import { collectionFixture } from './collectionFixture.ts';
import { createCustomer, addCustomerTransaction } from '../../src/server/domain/customers.ts';
import { assignCustomers, submitCollection, decideCollection, markCollectionCashReceived } from '../../src/server/domain/collections.ts';

/** Synthetic account cards; rejecting a receipt never creates a separate card. */
export function collectionAppearanceFixture() {
  const fixture = collectionFixture();
  const { db, admin, collector, ids, assignments } = fixture;
  for (let index = 0; index < 3; index++) db.prepare('UPDATE customers SET name=? WHERE id=?').run(`عميل تجريبي ${index + 1}`, ids[index]);
  for (let index = 3; index < 6; index++) {
    const created = createCustomer(db, admin, { name: `عميل تجريبي ${index + 1}`, openingBalance: 100, requestId: `appearance-${index}` }, 'test');
    const id = String((created.body.customer as { id: string }).id);
    ids.push(id);
    assignments.push(assignCustomers(db, admin, { customerIds: [id], assigneeUserId: collector.id }, 'test').assignmentIds[0]);
  }
  submitCollection(db, collector, assignments[1], { requestId: 'appearance-partial', mode: 'partial', amountUnits: 20 }, 'test');
  addCustomerTransaction(db, admin, ids[2], { requestId: 'appearance-credit', expectedVersion: 1, type: 'payment', paymentMode: 'partial', inputValue: 150 }, 'test');
  const zero = submitCollection(db, collector, assignments[3], { requestId: 'appearance-zero', mode: 'full' }, 'test');
  decideCollection(db, admin, zero.id, { decision: 'approve' }, 'test');
  const received = submitCollection(db, collector, assignments[4], { requestId: 'appearance-received', mode: 'full' }, 'test');
  decideCollection(db, admin, received.id, { decision: 'approve' }, 'test');
  markCollectionCashReceived(db, admin, received.id, 'test');
  const count = db.prepare('SELECT COUNT(*) AS count FROM debt_assignments').get()!.count;
  const rejected = submitCollection(db, collector, assignments[5], { requestId: 'appearance-rejected', mode: 'partial', amountUnits: 20 }, 'test');
  decideCollection(db, admin, rejected.id, { decision: 'reject' }, 'test');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM debt_assignments').get()!.count, count);
  return fixture;
}
