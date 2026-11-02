import { collectionFixture } from './collectionFixture.ts';
import { createCustomer } from '../../src/server/domain/customers.ts';
import {
  assignCustomers,
  closeCollectionDay,
  createUnlinkedCollectionReceipt,
  decideCollection,
  decideUnlinkedCollectionReceipt,
  listCollections,
  markCollectionCashReceived,
  markUnlinkedCollectionCashReceived,
  submitCollection,
} from '../../src/server/domain/collections.ts';

/** Synthetic records only. Includes >200 receipts, repeated partials and duplicate staff names. */
export function collectionBoardFixture(cardCount = 200) {
  const fixture = collectionFixture();
  const { db, admin, collector, other, assignments, ids } = fixture;
  db.prepare("UPDATE users SET display_name='أحمد علي' WHERE id IN (?,?)").run(collector.id, other.id);
  const old = submitCollection(
    db,
    collector,
    assignments[0],
    { mode: 'partial', amountUnits: 40, requestId: 'board-old-linked' },
    'fixture',
  );
  decideCollection(db, admin, old.id, { decision: 'approve' }, 'fixture');
  const oldReceipt = createUnlinkedCollectionReceipt(
    db,
    collector,
    { customerName: 'نقدية سابقة لعميل تجريبي', amountUnits: 30, requestId: 'board-old-unlinked' },
    'fixture',
  );
  decideUnlinkedCollectionReceipt(
    db,
    admin,
    oldReceipt.id,
    { decision: 'approve', customerId: ids[1], entryType: 'payment' },
    'fixture',
  );
  const oldBatch = listCollections(db, admin).openBatches[0];
  closeCollectionDay(
    db,
    admin,
    {
      batchId: oldBatch.id,
      confirmed: true,
      allowOutstandingCash: true,
      reason: 'سيناريو معاينة نقدية سابقة فقط',
      expectedCashPendingCount: 2,
      expectedCashPendingUnits: 70,
    },
    'fixture',
  );
  const staff = [collector, other];
  for (let index = 2; index < 4; index++) {
    const id = 'board-staff-' + index;
    db.prepare(
      `INSERT INTO users(id,username,display_name,password_hash,role,organization_id,home_branch_id,created_at,updated_at)
      SELECT ?,?,?,password_hash,'employee',organization_id,home_branch_id,created_at,updated_at FROM users WHERE id=?`,
    ).run(id, id, index === 2 ? 'محمد عبد الرحمن — فريق التحصيل المسائي' : 'محمود حسن', admin.id);
    for (const permission of ['collections.read', 'collections.write'])
      db.prepare('INSERT INTO user_permissions(user_id,permission,allowed,updated_at) VALUES(?,?,1,?)').run(
        id,
        permission,
        new Date().toISOString(),
      );
    staff.push({
      ...collector,
      id,
      username: id,
      displayName: index === 2 ? 'محمد عبد الرحمن' : 'محمود حسن',
    });
  }
  const currentAssignments: string[] = [],
    customerIds: string[] = [];
  for (let index = 0; index < cardCount; index++) {
    const company = index % 7 === 0;
    const name = `${company ? 'شركة' : 'عميل'} ${index % 11 === 0 ? 'عبد الرحمن محمد عبد الله — حساب تجريبي باسم طويل لاختبار الوضوح' : 'محمد علي'} ${String(index + 1).padStart(3, '0')}`;
    const result = createCustomer(
      db,
      admin,
      {
        name,
        openingBalance: index % 13 === 0 ? 123456789 : 20000 + index * 200,
        requestId: 'board-customer-' + index,
      },
      'fixture',
      company ? 'company' : 'customer',
    );
    const customerId = String((result.body.customer as { id: string }).id);
    customerIds.push(customerId);
    const employee = staff[index % staff.length];
    const assignment = assignCustomers(
      db,
      admin,
      {
        customerIds: [customerId],
        assigneeUserId: employee.id,
        section: company ? 'companies' : 'customers',
      },
      'fixture',
    ).assignmentIds[0];
    currentAssignments.push(assignment);
    if (index % 5 === 0) continue;
    const repeats = index % 5 === 3 ? 4 : 1;
    for (let repeat = 0; repeat < repeats; repeat++) {
      const full = index % 5 === 4;
      const amount = full ? (index % 13 === 0 ? 123456789 : 20000 + index * 200) : 100 + repeat * 25;
      const payment = submitCollection(
        db,
        employee,
        assignment,
        {
          mode: full ? 'full' : 'partial',
          amountUnits: amount,
          requestId: `board-payment-${index}-${repeat}`,
        },
        'fixture',
      );
      if (index % 5 !== 1) {
        decideCollection(db, admin, payment.id, { decision: 'approve' }, 'fixture');
        if (full || (repeat === 0 && repeats > 1))
          markCollectionCashReceived(db, admin, payment.id, 'fixture');
      }
    }
  }
  for (let index = 0; index < 30; index++) {
    const receipt = createUnlinkedCollectionReceipt(
      db,
      staff[index % staff.length],
      {
        customerName: 'استلام مستقل تجريبي ' + String(index + 1).padStart(2, '0'),
        amountUnits: 200 + index,
        requestId: 'board-independent-' + index,
      },
      'fixture',
    );
    if (index >= 10 && index < 25) {
      decideUnlinkedCollectionReceipt(
        db,
        admin,
        receipt.id,
        { decision: 'approve', customerId: customerIds[0], entryType: 'payment' },
        'fixture',
      );
      if (index >= 20) markUnlinkedCollectionCashReceived(db, admin, receipt.id, 'fixture');
    } else if (index >= 25)
      decideUnlinkedCollectionReceipt(db, admin, receipt.id, { decision: 'reject' }, 'fixture');
  }
  const batch = listCollections(db, admin).openBatches[0];
  return { ...fixture, staff, currentAssignments, customerIds, batch, oldBatch };
}
