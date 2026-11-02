import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionFixture } from './helpers/collectionFixture.ts';
import {
  submitCollection,
  decideCollection,
  markCollectionCashReceived,
  listCollections,
  createUnlinkedCollectionReceipt,
  decideUnlinkedCollectionReceipt,
  markUnlinkedCollectionCashReceived,
} from '../src/server/domain/collections.ts';
import { cancelCollectionApproval } from '../src/server/domain/collectionApprovalCancellation.ts';
import { addCustomerTransaction } from '../src/server/domain/customers.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';
import {
  collectionWorkspace,
  employeeCollectionWorkspace,
} from '../src/server/domain/collectionWorkspaceQueries.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import type { AddressInfo } from 'node:net';

function approved(mode: 'partial' | 'full' = 'partial') {
  const f = collectionFixture();
  const s = submitCollection(
    f.db,
    f.collector,
    f.assignments[0],
    { mode, amountUnits: mode === 'full' ? 100 : 40, requestId: 'wrong-receipt' },
    'test',
  );
  const approval = decideCollection(f.db, f.admin, s.id, { decision: 'approve' }, 'test');
  const input = {
    requestId: 'cancel-wrong-receipt',
    reason: 'الموظف اختار العميل الخطأ',
    expectedTransactionId: approval.transactionId,
  };
  return { ...f, s, approval, input };
}
test('cancelling one approval restores exactly its posting, retains evidence and later payments, and replays safely', () => {
  const { db, admin, collector, assignments, ids, s, input } = approved();
  try {
    const second = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 15, requestId: 'correct-receipt' },
      'test',
    );
    decideCollection(db, admin, second.id, { decision: 'approve' }, 'test');
    const version = Number(db.prepare('SELECT version FROM customers WHERE id=?').get(ids[0])!.version);
    addCustomerTransaction(
      db,
      admin,
      ids[0],
      {
        requestId: 'later-debt',
        expectedVersion: version,
        type: 'debt',
        inputValue: 20,
        calculationMode: 'direct',
      },
      'test',
    );
    const ledgerCount = db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n;
    cancelCollectionApproval(db, admin, s.id, input, 'test');
    assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n, 105);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n, ledgerCount);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE transaction_status='reversed'").get()!.n,
      1,
    );
    const after = db.prepare('SELECT current_balance_units,version FROM customers WHERE id=?').get(ids[0]);
    cancelCollectionApproval(db, admin, s.id, input, 'retry');
    cancelCollectionApproval(db, admin, s.id, { ...input, requestId: 'another-device' }, 'retry');
    assert.deepEqual(
      db.prepare('SELECT current_balance_units,version FROM customers WHERE id=?').get(ids[0]),
      after,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='collection.approval.cancel'").get()!.n,
      1,
    );
    assert.throws(() =>
      cancelCollectionApproval(db, admin, s.id, { ...input, reason: 'سبب مختلف بنفس المفتاح' }, 'test'),
    );
    assert.throws(() => markCollectionCashReceived(db, admin, s.id, 'test'));
    const dashboard = listCollections(db, admin);
    assert.equal(dashboard.metrics.cashOutstandingUnits, 15);
    assert.ok(dashboard.assignments.some((a) => a.id === assignments[0]));
    assert.notEqual(dashboard.assignments.find((a) => a.id === assignments[0])!.latestStatus, 'rejected');
    const rows = employeeCollectionWorkspace(db, collector, new URL('http://local/?state=all')).items;
    assert.equal(rows.find((row) => row.id === s.id)!.approvalCancelled, 1);
    assert.equal(
      collectionWorkspace(
        db,
        admin,
        new URL('http://local/?state=cash&batchId=' + dashboard.openBatches[0].id),
      ).totalItems,
      1,
    );
    assert.equal(reconcileFinancials(db).status, 'matched');
    const next = submitCollection(
      db,
      collector,
      assignments[0],
      { mode: 'partial', amountUnits: 10, requestId: 'after-cancel' },
      'test',
    );
    assert.ok(next.id);
  } finally {
    db.close();
  }
});
test('cash receipt, missing reason, foreign organization, employee, changed posting and stale reference block cancellation without side effects', () => {
  const { db, admin, collector, ids, s, input } = approved();
  try {
    const snapshot = () =>
      JSON.stringify(db.prepare('SELECT current_balance_units,version FROM customers ORDER BY id').all());
    const before = snapshot();
    assert.throws(() => cancelCollectionApproval(db, collector, s.id, input, 'test'));
    assert.throws(() =>
      cancelCollectionApproval(db, { ...admin, organizationId: 'foreign' }, s.id, input, 'test'),
    );
    assert.throws(() => cancelCollectionApproval(db, admin, s.id, { ...input, reason: 'خطأ' }, 'test'));
    assert.throws(() =>
      cancelCollectionApproval(db, admin, s.id, { ...input, expectedTransactionId: 'stale' }, 'test'),
    );
    assert.equal(snapshot(), before);
    db.prepare("UPDATE debt_transactions SET transaction_status='corrected' WHERE customer_id=?").run(ids[0]);
    assert.throws(() => cancelCollectionApproval(db, admin, s.id, input, 'test'));
    db.prepare("UPDATE debt_transactions SET transaction_status='posted' WHERE customer_id=?").run(ids[0]);
    markCollectionCashReceived(db, admin, s.id, 'test');
    assert.throws(() => cancelCollectionApproval(db, admin, s.id, input, 'test'));
    assert.equal(snapshot(), before);
  } finally {
    db.close();
  }
});
test('posting and receipt rollback together when receipt persistence fails', () => {
  const { db, admin, ids, assignments, s, input } = approved('full');
  try {
    const before = db.prepare('SELECT current_balance_units,version FROM customers WHERE id=?').get(ids[0]);
    db.exec(
      "CREATE TRIGGER fail_cancel BEFORE UPDATE OF status ON collection_submissions WHEN OLD.status='approved' AND NEW.status='rejected' BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    assert.throws(() => cancelCollectionApproval(db, admin, s.id, input, 'test'));
    assert.deepEqual(
      db.prepare('SELECT current_balance_units,version FROM customers WHERE id=?').get(ids[0]),
      before,
    );
    assert.equal(
      db.prepare('SELECT status FROM collection_submissions WHERE id=?').get(s.id)!.status,
      'approved',
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM debt_transactions WHERE transaction_status='reversed'").get()!.n,
      0,
    );
    db.exec('DROP TRIGGER fail_cancel');
    cancelCollectionApproval(db, admin, s.id, input, 'retry');
    assert.equal(db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n,100);
    assert.ok(listCollections(db,admin).assignments.some(a=>a.id===assignments[0] && a.balanceUnits===100));
    assert.equal(reconcileFinancials(db).status, 'matched');
  } finally {
    db.close();
  }
});
for (const entryType of ['payment', 'debt'] as const)
  test('unlinked ' + entryType + ' cancellation uses its actual ledger direction', () => {
    const { db, admin, collector, ids } = collectionFixture();
    try {
      const s = createUnlinkedCollectionReceipt(
        db,
        collector,
        { customerName: 'تجربة تصحيح', amountUnits: 25, requestId: 'unlinked-cancel' },
        'test',
      );
      const a = decideUnlinkedCollectionReceipt(
        db,
        admin,
        s.id,
        { decision: 'approve', customerId: ids[0], entryType },
        'test',
      );
      cancelCollectionApproval(
        db,
        admin,
        s.id,
        {
          requestId: 'undo-unlinked',
          reason: 'تصحيح اعتماد استلام خاطئ',
          expectedTransactionId: a.transactionId,
        },
        'test',
        'unlinked',
      );
      assert.equal(
        db.prepare('SELECT current_balance_units n FROM customers WHERE id=?').get(ids[0])!.n,
        100,
      );
      assert.throws(() => markUnlinkedCollectionCashReceived(db, admin, s.id, 'test'));
      assert.equal(reconcileFinancials(db).status, 'matched');
    } finally {
      db.close();
    }
  });
test('HTTP cancellation and cash confirmation race can only produce one successful state transition', async () => {
  const { db, admin, s, input } = approved();
  const server = createApp(db, loadConfig({ databasePath: ':memory:', internetRequired: false }));
  try {
    await listen(server, '127.0.0.1', 0);
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
      session = createSession(db, admin.id, '1', 12);
    const post = (path: string, body: unknown) =>
      fetch(base + path, {
        method: 'POST',
        headers: {
          Cookie: 'abdo_session=' + session.token,
          'X-CSRF-Token': session.csrfToken,
          'X-Client-Api-Version': '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const results = await Promise.all([
      post('/api/collections/submissions/' + s.id + '/cancel-approval', input),
      post('/api/collections/submissions/' + s.id + '/cash-received', {}),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(reconcileFinancials(db).status, 'matched');
    const row = db
      .prepare('SELECT status,cash_received_at FROM collection_submissions WHERE id=?')
      .get(s.id)!;
    assert.ok(
      row.status === 'rejected'
        ? row.cash_received_at === null
        : row.status === 'approved' && row.cash_received_at !== null,
    );
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  }
});
