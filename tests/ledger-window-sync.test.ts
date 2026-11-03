import test from 'node:test';
import assert from 'node:assert/strict';
import type { Ledger } from '../src/client/api.ts';
import { ledgerBalances } from '../src/client/sections/debts/ledgerModel.ts';
import { mergeFreshLedger, prependOlderLedgerPage } from '../src/client/dashboard/debtAccountState.ts';
import { oldestLedgerSequence, readLedgerWindow } from '../src/client/dashboard/ledgerReadWindow.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';
import {
  createCustomer,
  addCustomerTransaction,
  cancelCustomerTransaction,
  correctCustomerTransaction,
  customerLedger,
} from '../src/server/domain/customers.ts';

function fixture() {
  const db = openDatabase(':memory:');
  const admin = fixtureAdmin(db);
  const created = createCustomer(
    db,
    admin,
    { name: 'عميل اختبار سجل متعدد الصفحات', openingBalance: 0, requestId: 'window-account' },
    'test',
  );
  const id = String((created.body.customer as { id: string }).id);
  for (let i = 1; i <= 205; i++)
    addCustomerTransaction(
      db,
      admin,
      id,
      {
        requestId: 'window-' + i,
        expectedVersion: i,
        type: 'debt',
        inputValue: 1,
        calculationMode: 'direct',
      },
      'test',
    );
  const read = (before?: string | null) =>
    customerLedger(
      db,
      id,
      new URL('http://local/?limit=100' + (before ? '&before=' + before : '')),
      admin.organizationId,
    ) as unknown as Ledger;
  const cancel = (sequence: number) => {
    const snapshot = read(),
      row = db
        .prepare('SELECT id FROM debt_transactions WHERE customer_id=? AND customer_sequence=?')
        .get(id, sequence)!;
    cancelCustomerTransaction(
      db,
      admin,
      id,
      String(row.id),
      {
        requestId: 'cancel-window-' + sequence,
        expectedVersion: snapshot.customer.version,
        reason: 'تصحيح معاملة قديمة لاختبار المزامنة',
      },
      'test',
    );
  };
  return { db, admin, id, read, cancel };
}
const displayedLast = (ledger: Ledger) =>
  [...ledgerBalances(ledger).values()].at(-1) ?? ledger.pageOpeningBalanceUnits;

test('old cancellation and correction refresh every loaded page; running balances match authoritative account without stale rows', async () => {
  const f = fixture();
  try {
    const initial = await readLedgerWindow(async (_id, before) => f.read(before), f.id, 1);
    assert.equal(initial.items.length, 205);
    assert.equal(displayedLast(initial), 205);
    f.cancel(1);
    const latest = f.read();
    const fallback = mergeFreshLedger(initial, latest, f.id)!;
    assert.equal(fallback.items.length, 100);
    assert.equal(displayedLast(fallback), 204);
    const calls: (string | null | undefined)[] = [];
    const refreshed = await readLedgerWindow(
      async (_id, before) => {
        calls.push(before);
        return f.read(before);
      },
      f.id,
      oldestLedgerSequence(initial),
      latest,
    );
    assert.equal(calls.length, 2);
    assert.equal(refreshed.items.length, 205);
    assert.equal(refreshed.items[0].status, 'reversed');
    assert.equal(displayedLast(refreshed), 204);
    assert.equal(refreshed.customer.balanceUnits, 204);
    assert.equal(refreshed.nextCursor, null);
    const transaction = f.db
      .prepare('SELECT id FROM debt_transactions WHERE customer_id=? AND customer_sequence=80')
      .get(f.id)!;
    correctCustomerTransaction(
      f.db,
      f.admin,
      f.id,
      String(transaction.id),
      {
        requestId: 'old-correction',
        expectedVersion: refreshed.customer.version,
        type: 'debt',
        inputValue: 7,
        calculationMode: 'direct',
        reason: 'تصحيح معاملة قديمة',
      },
      'test',
    );
    const corrected = await readLedgerWindow(async (_id, before) => f.read(before), f.id, 1);
    assert.equal(corrected.items.find((item) => item.sequence === 80)!.amountUnits, 7);
    assert.equal(displayedLast(corrected), 210);
    assert.equal(corrected.customer.balanceUnits, 210);
    assert.equal(displayedLast(initial), 205, 'Original coherent view is not mutated');
  } finally {
    f.db.close();
  }
});

test('a revision change between pages restarts the snapshot and does not publish a mixed window', async () => {
  const f = fixture();
  try {
    let changed = false,
      reads = 0;
    const snapshot = await readLedgerWindow(
      async (_id, before) => {
        reads++;
        if (before && !changed) {
          changed = true;
          f.cancel(2);
        }
        return f.read(before);
      },
      f.id,
      1,
    );
    assert.equal(reads, 5);
    assert.equal(snapshot.items.length, 205);
    assert.equal(displayedLast(snapshot), 204);
    assert.equal(snapshot.customer.balanceUnits, 204);
    assert.equal(snapshot.items.find((item) => item.sequence === 2)!.status, 'reversed');
    assert.equal(new Set(snapshot.items.map((item) => item.id)).size, 205);
  } finally {
    f.db.close();
  }
});

test('stale older pages and delayed snapshots cannot overwrite a newer ledger; unchanged pages merge once', async () => {
  const f = fixture();
  try {
    const original = f.read(),
      older = f.read(original.nextCursor);
    const combined = prependOlderLedgerPage(original, older)!;
    assert.equal(combined.items.length, 200);
    assert.equal(prependOlderLedgerPage(combined, older)!.items.length, 200);
    assert.equal(displayedLast(combined), 205);
    f.cancel(1);
    const next = await readLedgerWindow(async (_id, before) => f.read(before), f.id, 1);
    assert.equal(prependOlderLedgerPage(next, older), next);
    assert.equal(mergeFreshLedger(next, original, f.id), next);
    assert.equal(
      mergeFreshLedger(next, { ...original, customer: { ...original.customer, id: 'other' } }, f.id),
      next,
    );
    assert.equal(displayedLast(next), 204);
  } finally {
    f.db.close();
  }
});

test('unloaded history is not fetched; network failures and continuous writes leave the previous snapshot intact', async () => {
  const f = fixture();
  try {
    const original = f.read();
    let reads = 0;
    f.cancel(1);
    const latest = await readLedgerWindow(
      async (_id, before) => {
        reads++;
        return f.read(before);
      },
      f.id,
      oldestLedgerSequence(original),
    );
    assert.equal(reads, 1);
    assert.equal(latest.items.length, 100);
    assert.equal(displayedLast(latest), 204);
    await assert.rejects(
      readLedgerWindow(
        async (_id, before) => {
          if (before) throw Error('offline');
          return f.read();
        },
        f.id,
        1,
      ),
    );
    assert.equal(displayedLast(original), 205);
    let revision = 0;
    await assert.rejects(
      readLedgerWindow(
        async (_id, before) => {
          const page = f.read(before);
          return { ...page, customer: { ...page.customer, version: ++revision } };
        },
        f.id,
        1,
      ),
    );
    assert.equal(revision, 6, 'Three bounded attempts instead of an endless read loop');
  } finally {
    f.db.close();
  }
});
