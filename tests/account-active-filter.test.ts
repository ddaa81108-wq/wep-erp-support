import assert from 'node:assert/strict';
import test from 'node:test';
import { accountCardFixture } from './helpers/accountCardFixture.ts';
import { listCustomers } from '../src/server/domain/customerQueries.ts';
import { visibleCustomerCards } from '../src/client/dashboard/dashboardModel.ts';
import type { Customer } from '../src/client/api.ts';
import { reviewCustomerZero } from '../src/server/domain/customerZeroReview.ts';

test('all cards include reviewed zeros while active counts exclude zero in four sections', () => {
  const { db, admin } = accountCardFixture(9);
  try {
    db.prepare('UPDATE customers SET zero_review_pending=1 WHERE current_balance_units=0').run();
    const before = db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all();
    for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp'] as const) {
      const all = listCustomers(db, new URL('http://local/api/accounts?limit=100'), admin.organizationId, kind);
      const active = listCustomers(db, new URL('http://local/api/accounts?filter=all&limit=100'), admin.organizationId, kind);
      const pending = listCustomers(db, new URL('http://local/api/accounts?filter=pending-review&limit=100'), admin.organizationId, kind);
      assert.equal(active.totalItems, all.totalItems);
      assert.equal(active.summary.activeCards, 6);
      assert.equal(pending.totalItems, 3);
      assert.deepEqual(active.summary, all.summary);
      assert.deepEqual(pending.summary, all.summary);
      const accounts = all.items as unknown as Customer[];
      assert.deepEqual(visibleCustomerCards(accounts, '', 'all').map(item => item.id), active.items.map(item => item.id));
      assert.deepEqual(visibleCustomerCards(accounts, '', 'pending-review').map(item => item.id), pending.items.map(item => item.id));
      assert.ok(active.items.some(item => Number(item.balanceUnits) < 0), 'Active includes deposits as well as debts');
      const zero = (pending.items as unknown as Customer[])[0];
      reviewCustomerZero(db, admin, zero.id, { expectedFinancialVersion: zero.zeroReview!.financialVersion }, 'test-review', kind);
      const after = listCustomers(db, new URL('http://local/api/accounts?filter=all&limit=100'), admin.organizationId, kind);
      assert.equal(after.totalItems, all.totalItems);
      assert.equal(after.summary.activeCards, 6);
      assert.equal(after.summary.pendingReviewCount, 2);
      const lastNonzero = Math.max(...after.items.flatMap((item, index) => Number(item.balanceUnits) === 0 ? [] : [index]));
      assert.ok(after.items.findIndex(item => item.id === zero.id) > lastNonzero, 'Reviewed zero is retained below active balances');
      assert.equal(after.summary.netBalance, all.summary.netBalance);
    }
    assert.deepEqual(db.prepare('SELECT id,current_balance_units,version FROM customers ORDER BY id').all(), before);
  } finally { db.close(); }
});
