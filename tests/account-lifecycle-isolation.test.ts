import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import { createCustomer } from '../src/server/domain/customerAccountCommands.ts';
import {
  addCustomerTransaction,
  correctCustomerTransaction,
  cancelCustomerTransaction,
} from '../src/server/domain/customerTransactions.ts';
import { operationsSnapshot } from '../src/server/domain/operationsCenter.ts';

for (const kind of ['customer', 'company', 'depositLyd', 'depositEgp'] as const) {
  test(
    kind + ': correction, cancellation, retries and conflicts preserve other sections and old notes',
    () => {
      const db = openDatabase(':memory:');
      try {
        const actor = fixtureAdmin(db);
        const accounts = new Map<string, string>();
        for (const other of ['customer', 'company', 'depositLyd', 'depositEgp'] as const) {
          const created = createCustomer(
            db,
            actor,
            { name: 'Isolated ' + other, openingBalance: 100, requestId: 'create-account-' + other },
            'test',
            other,
          );
          accounts.set(other, (created.body.customer as { id: string }).id);
        }
        const id = accounts.get(kind)!;
        const balance = (account: string) =>
          db.prepare('SELECT current_balance_units FROM customers WHERE id=?').get(account)!
            .current_balance_units;
        const input = {
          requestId: 'payment-retry-' + kind,
          expectedVersion: 1,
          type: 'payment',
          paymentMode: 'partial',
          inputValue: 150,
          calculationMode: 'direct',
          note: 'Original note retained',
        };
        const added = addCustomerTransaction(db, actor, id, input, 'test', kind);
        assert.equal(added.body.balanceUnits, -50);
        const transaction = added.body.transaction as { id: string };
        const count = () => db.prepare('SELECT COUNT(*) n FROM debt_transactions').get()!.n;
        const beforeCount = count();
        assert.equal(addCustomerTransaction(db, actor, id, input, 'retry', kind).replayed, true);
        assert.equal(count(), beforeCount);
        assert.throws(
          () => addCustomerTransaction(db, actor, id, { ...input, inputValue: 151 }, 'test', kind),
          { code: 'REQUEST_ID_REUSED' },
        );
        assert.throws(() =>
          addCustomerTransaction(
            db,
            actor,
            id,
            { ...input, requestId: 'stale-version-' + kind },
            'test',
            kind,
          ),
        );
        assert.equal(balance(id), -50);
        const corrected = correctCustomerTransaction(
          db,
          actor,
          id,
          transaction.id,
          { ...input, requestId: 'correct-account-' + kind, expectedVersion: 2, inputValue: 40 },
          'test',
          kind,
        );
        assert.equal(corrected.body.balanceUnits, 60);
        const replacement = corrected.body.transaction as { id: string };
        const cancelled = cancelCustomerTransaction(
          db,
          actor,
          id,
          replacement.id,
          { requestId: 'cancel-account-' + kind, expectedVersion: 3, reason: 'Test cancellation' },
          'test',
          kind,
        );
        assert.equal(cancelled.body.balanceUnits, 100);
        assert.equal(
          db.prepare('SELECT note FROM debt_transactions WHERE id=?').get(transaction.id)!.note,
          'Original note retained',
        );
        for (const account of accounts.values()) assert.equal(balance(account), 100);
        assert.throws(() =>
          addCustomerTransaction(
            db,
            actor,
            id,
            { ...input, requestId: 'wrong-section-' + kind, expectedVersion: 4 },
            'test',
            kind === 'customer' ? 'company' : 'customer',
          ),
        );
        for (const account of accounts.values()) assert.equal(balance(account), 100);
      } finally {
        db.close();
      }
    },
  );
}
test('operations status reflects configured network policy without changing it', () => {
  const db = openDatabase(':memory:');
  try {
    const actor = fixtureAdmin(db);
    assert.equal(operationsSnapshot(db, actor, false).onlineOnly, false);
    assert.equal(operationsSnapshot(db, actor, true).onlineOnly, true);
  } finally {
    db.close();
  }
});
