import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/server/db/database.ts';
import { migrations } from '../src/server/db/migrations.ts';
import { createCustomer, addCustomerTransaction, customerSnapshot, listCustomers, setCustomerPinned, updateCustomerDetails } from '../src/server/domain/customers.ts';
import { reviewCustomerZero } from '../src/server/domain/customerZeroReview.ts';
import { fixtureAdmin } from './helpers/financialFixture.ts';

test('zero review is administrative, revision-bound, idempotent and financially inert', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    const created = createCustomer(db, admin, { requestId: randomUUID(), name: 'عميل المراجعة', openingBalance: 100 }, 'test');
    const id = (created.body.customer as { id: string }).id;
    const snapshot = () => customerSnapshot(db, id, admin.organizationId);
    const move = (type: string, amount: number) => addCustomerTransaction(db, admin, id,
      { requestId: randomUUID(), expectedVersion: snapshot().version, type, inputValue: amount, calculationMode: 'direct' }, 'test');
    move('payment', 100);
    const pending = snapshot();
    assert.equal(pending.zeroReview?.pending, true);
    const input = { expectedFinancialVersion: pending.zeroReview!.financialVersion };
    assert.throws(() => reviewCustomerZero(db, { ...admin, role: 'employee', permissions: new Set(['debts.write']) }, id, input, 'test'), { status: 403 });
    assert.throws(() => reviewCustomerZero(db, { ...admin, organizationId: 'other-org' }, id, input, 'test'), { status: 404 });
    assert.throws(() => reviewCustomerZero(db, admin, id, { expectedFinancialVersion: '1' }, 'test'), { status: 400 });
    const ledgerBefore = db.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    const reviewed = reviewCustomerZero(db, admin, id, input, 'test');
    assert.equal(reviewed.status, 200);
    const after = snapshot();
    assert.equal(after.version, pending.version);
    assert.equal(after.balanceUnits, 0);
    assert.equal(after.updatedAt, pending.updatedAt);
    assert.equal(after.zeroReview?.pending, false);
    assert.equal(after.zeroReview?.reviewedByName, admin.displayName);
    assert.deepEqual(db.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), ledgerBefore);
    const replay = reviewCustomerZero(db, admin, id, input, 'test');
    assert.equal(replay.body.replayed, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='customer.zero_review'").get()?.n, 1);
    setCustomerPinned(db, admin, id, { expectedVersion: after.version, isPinned: true }, 'test');
    updateCustomerDetails(db, admin, id, { expectedVersion: snapshot().version, name: 'عميل مراجعة معدل', phone: '' }, 'test');
    assert.deepEqual(snapshot().zeroReview, after.zeroReview);
    move('debt', 25);
    assert.equal(snapshot().zeroReview?.reviewedAt, null);
    move('payment', 25);
    assert.equal(snapshot().zeroReview?.pending, true);
    assert.throws(() => reviewCustomerZero(db, admin, id, input, 'test'), { status: 409, code: 'ZERO_REVIEW_CHANGED' });
    assert.equal(snapshot().zeroReview?.pending, true);
  } finally { db.close(); }
});

test('pending zero feed stays visible, sorts by movement and pages without duplicates; other sections stay unchanged', () => {
  const db = openDatabase(':memory:');
  try {
    const admin = fixtureAdmin(db);
    const make = (name: string, openingBalance: number, kind: 'customer' | 'company' = 'customer') =>
      (createCustomer(db, admin, { requestId: randomUUID(), name, openingBalance }, 'test', kind).body.customer as { id: string }).id;
    const debt = make('دين قديم', 100);
    const credit = make('أمانة', 0);
    addCustomerTransaction(db, admin, credit, { requestId: randomUUID(), expectedVersion: 1, type: 'payment', inputValue: 10, calculationMode: 'direct' }, 'test');
    const zero = make('صفر جديد', 0);
    db.prepare('UPDATE customers SET financial_updated_at=? WHERE id=?').run('2026-01-01T01:00:00Z', debt);
    db.prepare('UPDATE customers SET financial_updated_at=? WHERE id=?').run('2026-01-02T01:00:00Z', credit);
    db.prepare('UPDATE customers SET financial_updated_at=?,inactive_since=? WHERE id=?')
      .run('2026-01-03T01:00:00Z', '2000-01-01T00:00:00Z', zero);
    const feed = (query: string) => listCustomers(db, new URL('http://test/api/customers?' + query), admin.organizationId);
    const before = feed('filter=smart');
    assert.deepEqual(before.items.map(x => x.id), [zero, credit, debt]);
    assert.equal(before.summary.activeCards, 2);
    assert.equal(before.summary.pendingReviewCount, 1);
    assert.equal(before.summary.totalDebt, 100);
    assert.equal(before.items[0].hiddenFromDefault, false);
    assert.deepEqual(feed('filter=pending-review&q=' + encodeURIComponent('صفر')).items.map(x => x.id), [zero]);
    reviewCustomerZero(db, admin, zero, { expectedFinancialVersion: before.items[0].zeroReview!.financialVersion }, 'test');
    assert.deepEqual(feed('filter=all').items.map(x => x.id), [credit, debt, zero]);
    assert.equal(feed('filter=smart').items.length, 2);
    assert.equal(feed('filter=pending-review').totalItems, 0);
    const company = make('شركة صفر', 0, 'company');
    assert.equal(customerSnapshot(db, company, admin.organizationId, 'company').zeroReview, undefined);
    assert.throws(() => reviewCustomerZero(db, admin, company, { expectedFinancialVersion: 0 }, 'test'), { status: 404 });
    for (let i = 0; i < 25; i++) make(`صفحات المراجعة ${i}`, i % 2 === 0 ? 0 : 10);
    const first = feed('filter=all&limit=20');
    const second = feed('filter=all&limit=20&cursor=' + first.nextCursor);
    assert.equal(first.items.length, 20);
    assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, 28);
    assert.equal(second.nextCursor, null);
  } finally { db.close(); }
});

test('schema 45 preserves historical zero cards and ledger; new zero cards alone request review', () => {
  const directory = mkdtempSync(join(tmpdir(), 'zero-review-upgrade-'));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  try {
    legacy.exec('PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT');
    for (const migration of migrations.filter(x => x.version <= 44)) {
      legacy.exec('BEGIN IMMEDIATE'); migration.before?.(legacy); legacy.exec(migration.sql); migration.after?.(legacy);
      legacy.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(migration.version, migration.name, new Date().toISOString());
      legacy.exec('COMMIT');
    }
    const admin = fixtureAdmin(legacy);
    for (const [name, balance] of [['قديم صفر', 0], ['قديم دين', 100], ['قديم دين ثان', 20]] as const) {
      createCustomer(legacy, admin, { requestId: randomUUID(), name, openingBalance: balance }, 'test');
    }
    const before = legacy.prepare('SELECT id,version,current_balance_units,financial_updated_at FROM customers ORDER BY id').all();
    const transactions = legacy.prepare('SELECT * FROM debt_transactions ORDER BY id').all();
    legacy.close();
    const upgraded = openDatabase(path);
    try {
      assert.deepEqual(upgraded.prepare('SELECT id,version,current_balance_units,financial_updated_at FROM customers ORDER BY id').all(), before);
      assert.deepEqual(upgraded.prepare('SELECT * FROM debt_transactions ORDER BY id').all(), transactions);
      assert.equal(upgraded.prepare('SELECT SUM(zero_review_pending) AS n FROM customers').get()?.n, 0);
      createCustomer(upgraded, admin, { requestId: randomUUID(), name: 'صفر بعد التحديث', openingBalance: 0 }, 'test');
      assert.equal(upgraded.prepare('SELECT SUM(zero_review_pending) AS n FROM customers').get()?.n, 1);
      assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { upgraded.close(); }
  } finally { if (legacy.isOpen) legacy.close(); rmSync(directory, { recursive: true, force: true }); }
});
