import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { collectionFixture } from './helpers/collectionFixture.ts';
import { openDatabase } from '../src/server/db/database.ts';
import { createCustomer, addCustomerTransaction } from '../src/server/domain/customers.ts';
import {
  createUnlinkedCollectionReceipt,
  decideUnlinkedCollectionReceipt,
  collectionLinkCandidates,
  listCollections,
} from '../src/server/domain/collections.ts';
import { HttpError } from '../src/server/http/errors.ts';
import { createApp, listen } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createSession } from '../src/server/security/sessions.ts';
import { reconcileFinancials } from '../src/server/domain/financialReconciliation.ts';

test('unlinked receipts persist LYD as the only currency; requests and SQL cannot switch it', () => {
  const { db, collector } = collectionFixture();
  try {
    const body = { requestId: 'currency-fixed-lyd', customerName: 'استلام دينار', amountUnits: 20 };
    const receipt = createUnlinkedCollectionReceipt(db, collector, body, 'test');
    assert.equal(receipt.currency, 'LYD');
    assert.equal(createUnlinkedCollectionReceipt(db, collector, body, 'retry').currency, 'LYD');
    assert.equal(
      db.prepare('SELECT currency FROM collection_unlinked_receipts WHERE id=?').get(receipt.id)!.currency,
      'LYD',
    );
    for (const currency of ['EGP', 'USD', 'lyd', null, 0])
      assert.throws(
        () => createUnlinkedCollectionReceipt(db, collector, { ...body, currency }, 'test'),
        (error) => error instanceof HttpError && error.code === 'UNLINKED_RECEIPT_CURRENCY_INVALID',
      );
    assert.throws(
      () => db.prepare("UPDATE collection_unlinked_receipts SET currency='EGP' WHERE id=?").run(receipt.id),
      /CHECK constraint failed/,
    );
    assert.equal(db.prepare('SELECT COUNT(*) n FROM collection_unlinked_receipts').get()!.n, 1);
  } finally {
    db.close();
  }
});

test('candidates expose LYD accounts only; EGP linking is rejected atomically even with forged currency or a conversion rate', () => {
  const { db, admin, collector } = collectionFixture();
  try {
    const ids = (['customer', 'company', 'depositLyd', 'depositEgp'] as const).map((kind) => {
      const result = createCustomer(
        db,
        admin,
        { requestId: `currency-account-${kind}`, name: `اختبار العملة ${kind}`, openingBalance: 100 },
        'test',
        kind,
      );
      return String((result.body.customer as { id: string }).id);
    });
    const candidates = collectionLinkCandidates(db, admin, 'اختبار العملة').items;
    assert.equal(candidates.length, 3);
    assert.ok(
      candidates.every(
        (candidate) => candidate.currency === 'LYD' && candidate.sectionKey !== 'egyptian_deposits',
      ),
    );
    assert.ok(!candidates.some((candidate) => candidate.id === ids[3]));
    for (const entryType of ['debt', 'payment']) {
      const receipt = createUnlinkedCollectionReceipt(
        db,
        collector,
        {
          requestId: `currency-egp-reject-${entryType}`,
          customerName: 'رفض ربط مصري',
          amountUnits: 20,
          currency: 'LYD',
        },
        'test',
      );
      const before = ['debt_transactions', 'audit_log', 'event_log', 'idempotency_keys'].map(
        (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,
      );
      for (const extra of [{}, { currency: 'LYD', rateMicros: 5_000_000 }, { currency: 'EGP' }])
        assert.throws(
          () =>
            decideUnlinkedCollectionReceipt(
              db,
              admin,
              receipt.id,
              { decision: 'approve', customerId: ids[3], entryType, ...extra },
              'test',
            ),
          (error) => error instanceof HttpError && error.code === 'COLLECTION_CURRENCY_MISMATCH',
        );
      assert.deepEqual(
        ['debt_transactions', 'audit_log', 'event_log', 'idempotency_keys'].map(
          (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n,
        ),
        before,
      );
      assert.equal(
        db.prepare('SELECT status FROM collection_unlinked_receipts WHERE id=?').get(receipt.id)!.status,
        'pending',
      );
      assert.equal(
        db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(ids[3])!.balance,
        100,
      );
    }
    for (const id of ids.slice(0, 3)) {
      const receipt = createUnlinkedCollectionReceipt(
        db,
        collector,
        { requestId: `currency-allowed-${id}`, customerName: 'ربط دينار', amountUnits: 20 },
        'test',
      );
      decideUnlinkedCollectionReceipt(
        db,
        admin,
        receipt.id,
        { decision: 'approve', customerId: id, entryType: 'payment' },
        'test',
      );
      const row = db
        .prepare(
          'SELECT t.currency,t.amount_units FROM collection_unlinked_receipts r JOIN debt_transactions t ON t.id=r.approved_transaction_id WHERE r.id=?',
        )
        .get(receipt.id)!;
      assert.equal(row.currency, 'LYD');
      assert.equal(row.amount_units, 20);
      assert.equal(
        db.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(id)!.balance,
        80,
      );
    }
  } finally {
    db.close();
  }
});

test('HTTP approval cannot bypass currency matching or employee permissions', async () => {
  const { db, admin, collector } = collectionFixture();
  const server = createApp(
    db,
    loadConfig({
      databasePath: ':memory:',
      publicOrigin: '',
      internetRequired: false,
      secureCookie: false,
      pushPublicKey: '',
      pushPrivateKey: '',
    }),
  );
  try {
    const created = createCustomer(
      db,
      admin,
      { requestId: 'http-egp-currency-account', name: 'حساب مصري', openingBalance: 100 },
      'test',
      'depositEgp',
    );
    const customerId = String((created.body.customer as { id: string }).id);
    const receipt = createUnlinkedCollectionReceipt(
      db,
      collector,
      { requestId: 'http-egp-currency-receipt', customerName: 'استلام', amountUnits: 20 },
      'test',
    );
    await listen(server, '127.0.0.1', 0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const session = createSession(db, admin.id, '1', 12);
    const headers = {
      'Content-Type': 'application/json',
      'X-Client-Api-Version': '1',
      'X-CSRF-Token': session.csrfToken,
      cookie: `abdo_session=${session.token}`,
    };
    const response = await fetch(`${base}/api/collections/unlinked-receipts/${receipt.id}/decision`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ decision: 'approve', customerId, entryType: 'payment', currency: 'LYD' }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'COLLECTION_CURRENCY_MISMATCH');
    const employeeSession = createSession(db, collector.id, '1', 12);
    const rejected = await fetch(`${base}/api/collections/unlinked-receipts`, {
      method: 'POST',
      headers: {
        ...headers,
        cookie: `abdo_session=${employeeSession.token}`,
        'X-CSRF-Token': employeeSession.csrfToken,
      },
      body: JSON.stringify({
        requestId: 'http-create-invalid-egp',
        customerName: 'استلام',
        amountUnits: 20,
        currency: 'EGP',
      }),
    });
    assert.equal(rejected.status, 400);
    const suggestions = await fetch(
      `${base}/api/collections/link-candidates?q=${encodeURIComponent('حساب مصري')}`,
      { headers },
    );
    assert.equal((await suggestions.json()).data.items.length, 0);
  } finally {
    server.closeRealtimeConnections();
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
  }
});

test('schema 51 upgrade preserves old receipt amounts and exposes historical cross-currency links without rewriting balances', () => {
  const root = mkdtempSync(join(tmpdir(), 'unlinked-currency-upgrade-')),
    path = join(root, 'test.sqlite');
  const { db, admin, collector } = collectionFixture(path);
  let closed = false;
  try {
    const created = createCustomer(
      db,
      admin,
      { requestId: 'legacy-egp-account', name: 'مصري قديم', openingBalance: 100 },
      'test',
      'depositEgp',
    );
    const customerId = String((created.body.customer as { id: string }).id);
    const receipt = createUnlinkedCollectionReceipt(
      db,
      collector,
      { requestId: 'legacy-currency-receipt', customerName: 'استلام قديم', amountUnits: 20 },
      'test',
    );
    const posted = addCustomerTransaction(
      db,
      admin,
      customerId,
      { requestId: `unlinked-collection-${receipt.id}`, expectedVersion: 1, type: 'payment', inputValue: 20 },
      'test',
      'depositEgp',
    );
    const transactionId = String((posted.body.transaction as { id: string }).id);
    db.prepare(
      "UPDATE collection_unlinked_receipts SET status='approved',linked_customer_id=?,entry_type='payment',approved_transaction_id=? WHERE id=?",
    ).run(customerId, transactionId, receipt.id);
    const pending = createUnlinkedCollectionReceipt(
      db,
      collector,
      { requestId: 'legacy-pending-currency', customerName: 'معلق قديم', amountUnits: 15 },
      'test',
    );
    db.exec(
      'ALTER TABLE collection_unlinked_receipts DROP COLUMN currency; DELETE FROM schema_migrations WHERE version=52;',
    );
    db.close();
    closed = true;
    const upgraded = openDatabase(path);
    try {
      const receipts = listCollections(upgraded, admin).unlinkedReceipts;
      assert.equal(receipts.find((r) => r.id === receipt.id)!.currency, 'LYD');
      assert.equal(receipts.find((r) => r.id === receipt.id)!.currencyMismatch, 1);
      assert.equal(receipts.find((r) => r.id === pending.id)!.amountUnits, 15);
      assert.equal(
        upgraded.prepare('SELECT current_balance_units balance FROM customers WHERE id=?').get(customerId)!
          .balance,
        80,
      );
      assert.throws(
        () =>
          decideUnlinkedCollectionReceipt(
            upgraded,
            admin,
            pending.id,
            { decision: 'approve', customerId, entryType: 'payment' },
            'test',
          ),
        (error) => error instanceof HttpError && error.code === 'COLLECTION_CURRENCY_MISMATCH',
      );
      const report = reconcileFinancials(upgraded);
      assert.ok(report.issues.some((issue) => issue.field === 'receipt.currency'));
    } finally {
      upgraded.close();
    }
  } finally {
    if (!closed) db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
